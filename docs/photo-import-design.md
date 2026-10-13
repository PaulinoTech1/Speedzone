# Inventory photo import: design (not implemented)

Status: **design only.** This depends on how DealerCenter delivers photos (see `docs/dealercenter-integration-requirements.md`, item 2). The importer in PR #121 counts export photo URLs but doesn't store them.

## Goal
Copy vehicle photos referenced by a DealerCenter export into the site's own public inventory Blob store, so they follow the same rules as admin uploads:
- formats: JPEG/PNG/WebP
- at most 8 MB each and 24 per listing (`src/lib/inventory-photos.ts`)
- store-origin checks
- the image proxy
- deferred orphan cleanup

The site never hotlinks DealerCenter URLs. Hotlinks break when DealerCenter rotates CDN URLs, leak visitor requests to a third party, and bypass our validation.

## Threat model
- **SSRF.** A feed or override could point at internal addresses (169.254.169.254, localhost, private ranges) or redirect to them.
- **Hostile content.** Decompression bombs, oversize files, polyglots, or non-image content served with an image MIME type.
- **Resource exhaustion.** Hundreds of vehicles × 24 photos inside one serverless invocation.
- **Integrity.** A photo changes behind the same URL, or duplicate downloads pile up in the Blob store.

## Design

### 1. Source allowlist
- Env var `DEALERCENTER_PHOTO_HOSTS`: comma-separated exact hostnames, for example DealerCenter's image CDN once we know it. It is empty by default, which means photo import is disabled.
- Only HTTPS on port 443. URLs with credentials or with IP-literal hosts are rejected.
- Before connecting, resolve DNS and reject private, loopback, link-local or CGNAT addresses, IPv4 and IPv6. Connect to the vetted address (pin it) to prevent DNS rebinding.
- Don't follow redirects automatically. Allow at most 2, and re-run the full allowlist and IP checks on each hop.

### 2. Fetch limits
- 10-second total timeout per photo.
- Abort when the streamed body passes 8 MB; don't trust Content-Length.
- At most 4 photos per vehicle in parallel and 24 per listing; the rest are reported as skipped.

### 3. Validation and re-encode
- Detect the type from magic bytes (JPEG/PNG/WebP only) instead of the response headers.
- Decode with `sharp` (already a dependency), with `limitInputPixels` of about 40 MP and `failOn: "error"`.
- Strip all metadata (EXIF/GPS) and auto-rotate.
- Resize to fit 2400 px, matching `maxPhotoDimension` in the admin uploader, and re-encode to WebP at quality 82. Re-encoding removes polyglot and trailing payloads.

### 4. Dedupe and storage
- Content hash = SHA-256 of the **re-encoded** bytes.
- Path: `inventory/photos/dc-<sha256>.webp`, which `isInventoryPhotoPath` must accept. Write with `allowOverwrite: false`. If the blob already exists, reuse its URL.
- Redis map `speedzone:inventory:photo-source:<sha256(source URL)>` → `{ contentHash, etag, lastModified, fetchedAt }`, so later syncs send `If-None-Match` / `If-Modified-Since` and skip unchanged photos.

### 5. Catalog commit
- Photos are attached in the **same revisioned commit** as the import (`writeInventory`). The commit script already refuses photo URLs marked `deleting`/`deleted`.
- Export order is kept and capped at 24. If **every** photo for a vehicle fails, the vehicle keeps its existing site photos.
- **Policy decision (Alexander):** when an import brings photos for a vehicle that has manually uploaded photos, either replace them, or keep the manual ones first and then append. The recommended default is to replace only listings whose photos all came from previous imports. That needs an optional `photoSource: "dealercenter" | "manual"` field on each listing.
- Replaced photos are not deleted inline. The existing age-gated orphan cleanup collects them.

### 6. Where it runs
- **Manual import (PR #121 flow):** photos download after the admin clicks Apply. A per-request budget (about 60 photos, under the Vercel function time limit) keeps it bounded; the remaining photos are queued.
- **Queue:** Redis list `speedzone:inventory:photo-queue` of `{ vehicleId, sourceUrl, position }`. A Vercel Cron route (`/api/cron/photo-import`, `Authorization: Bearer $CRON_SECRET`) drains it in batches, using the same revision-checked commit and retrying on conflicts.
- **Scheduled pull (future):** the same queue, fed by the feed sync.

### 7. Audit and observability
- Security events (`inventory.mutation`, reasons `photo_import_completed` and `photo_import_rejected`) record counts and rejection classes only, such as `host_not_allowed`, `private_address`, `too_large`, `bad_type`, `decode_failed` or `timeout`. They never include source URLs: they could identify accounts, and they aren't needed.
- The admin import preview shows "N photos will be imported / M skipped (reason counts)".

## Tests to add when implementing
- Allowlist and IP checks: private IPv4/IPv6, IP literals, userinfo, non-443 ports, and a redirect into a private range.
- Streaming size limit, magic-byte mismatch, pixel-limit bomb (a tiny file with huge dimensions), and confirmation that EXIF/GPS is gone after re-encode.
- Dedupe by content hash and conditional re-fetch (304).
- A commit conflict during the photo attach is retried, and nothing is lost.

## Open questions
1. DealerCenter's photo delivery: URLs in a column (which separator), one column per photo, or files in the FTP/SFTP drop? Which CDN hostname?
2. Are the URLs stable, or signed and expiring?
3. Replace or merge with manual photos (policy above)?
4. Should DealerCenter overlays or watermarks be kept, or should we ask DealerCenter for clean originals?
