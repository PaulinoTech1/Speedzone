# Security

SpeedZone Motorsports consists of a public Next.js application and a separately deployable `security-console/` application. The root application includes admin authentication, inventory mutations, test-drive submissions, uploads, rate limiting, and security-event logging. The security console uses an independent password, WebAuthn passkeys, Redis sessions, rate-limit namespace, and host-only cookie.

## Root application security model

The root application uses `SPEEDZONE_ADMIN_PASSWORD` as the password bootstrap path when no current credential exists. The password is hashed with Argon2id; authentication state, credential epochs, session generations, and server-side sessions are stored in Redis. Sessions use randomized tokens, hashed Redis keys, absolute and idle expiration, generation-based revocation, and route-level authorization checks. Login and recovery endpoints are rate limited. WebAuthn/passkeys are supported as an additional authentication method, but a passkey is not required for the password-authenticated admin to use inventory administration.

Inventory reads, mutations, and photo uploads require an authenticated admin session. The inventory upload flow uses a short-lived Vercel Blob client token generated server-side, sends the HTTP-only admin cookie with the token request, and uploads only validated inventory photo paths. Accepted image formats are JPEG/JPG, PNG, and WebP, with size and count limits; returned Blob URLs are checked against the Blob store associated with `BLOB_READ_WRITE_TOKEN`, using case-insensitive hostname comparison. `BLOB_STORE_ID` is an identifier only and is not an upload credential. Inventory photo proxying validates the store, path, and image response before serving it.

Test-drive submissions reach the server in plaintext, are validated and rate limited, then are encrypted server-side with AES-256-GCM using `TEST_DRIVE_ENCRYPTION_KEY` and stored in private Vercel Blob objects. Authenticated admin functionality decrypts them server-side. This is application-layer encryption at rest, not browser-only, zero-knowledge, or end-to-end encryption.

If configured, Resend notification email may include test-drive information. Do not add service secrets to browser code or commit environment files.

## Security events

`src/lib/security-events.ts` provides typed event categories, event IDs, request correlation IDs, ISO timestamps, outcome and actor classification, route and method information, bounded metadata, prohibited-field filtering, deterministic canonical serialization, SHA-256 hashes for individual events, and individual-event hash verification.

The event structure has an optional `previousHash`, but the current application does not implement a globally serialized hash chain or automatically populate a trustworthy previous hash for every event. This repository does not establish Merkle roots, AWS KMS signing, S3 Object Lock, a WORM archive, or a provisioned Vercel Drain.

When `SECURITY_LOG_PROVIDER=axiom` and the ingest URL and token are configured, `writeSecurityEvent()` supports best-effort Axiom-style HTTP ingestion. Logging delivery is fail-open with respect to the business request; a logging failure does not block the request. Not every possible security decision is necessarily instrumented.

See [`docs/security-logging.md`](docs/security-logging.md) for the current logging notes and residual risks.

## Security console status

`security-console/` has separate Redis configuration names, security headers, read-only recent-event and individual-event views, an integrity-status page, and login/setup/passkey UI surfaces. It fails closed when authentication storage or the event provider cannot be read.

Its independent Redis configuration is:

```text
ADMIN_SECURITY_KV_REST_API_URL
ADMIN_SECURITY_KV_REST_API_TOKEN
```

The console uses the writable `ADMIN_SECURITY_KV_REST_API_URL` and `ADMIN_SECURITY_KV_REST_API_TOKEN` pair. Provider-created read-only and TCP connection variables are not used because credentials, sessions, challenges, replay records, and rate-limit counters require writes. The one-time setup exchanges `SECURITY_BOOTSTRAP_TOKEN` for an Argon2id password record in the console Redis. A password session can enroll or authenticate a passkey; event pages and event APIs require the upgraded MFA session. Sessions have four-hour absolute and fifteen-minute idle expiry, support individual and global revocation, and use the `__Host-speedzone_security` Secure, HTTP-only, SameSite=Strict cookie. The inventory cookie is not inspected or accepted.

The event reader uses the configured external provider query API. Redis is used only for console credentials, sessions, challenges, and rate limits. Delivery testing is server-to-server, signed with `SECURITY_CONSOLE_TEST_SECRET`, replay protected, and limited to two attempts per fifteen minutes. No ingest or query token reaches the browser.

## Target deployment boundary

The intended deployment boundary is:

- Primary application: normal SpeedZone deployment with inventory/admin Redis and inventory-admin credentials.
- Security console: separate Vercel deployment at `logs.speedzonems.com`, separate Redis, separate WebAuthn RP, separate passkeys, and read-only security-log access.
- External logging/integrity infrastructure: Axiom or Vercel Drain, immutable archival storage, Merkle roots, and signing with a key outside the application runtime.

External Vercel Drain, Axiom, S3 Object Lock, KMS signing, DNS, alerting, and retention controls are not provisioned by this repository merely because they appear in architecture documentation. Configure and verify those controls independently.

## Configuration handling

Keep confidential values server-side and rotate them through the deployment secret manager. Relevant root-application names include `TEST_DRIVE_ENCRYPTION_KEY`, `SPEEDZONE_ADMIN_PASSWORD`, `BLOB_READ_WRITE_TOKEN`, `TEST_DRIVE_BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, `SECURITY_LOG_PROVIDER`, `SECURITY_LOG_INGEST_URL`, `SECURITY_LOG_INGEST_TOKEN`, the Redis variables, Resend variables, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID`. `INVENTORY_BLOB_ORIGIN` is retained only as a legacy fallback; the inventory upload store is derived from the store identifier embedded in `BLOB_READ_WRITE_TOKEN` when available. The security console has separate Redis, WebAuthn, bootstrap, and provider configuration names.

RP IDs, origins, store IDs, and webhook public keys are identifiers or verification configuration, not upload credentials. Redis tokens, Blob read/write tokens, Resend API keys, ingest credentials, bootstrap tokens, and encryption keys are confidential. Never publish their values in source, issues, logs, screenshots, or documentation.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Include the affected route or component, reproduction steps, impact, and relevant timestamps without including secret values or personal test-drive data. If a credential or token may have been exposed, revoke or rotate it at the provider, replace it in the deployment secret manager, redeploy, and review recent usage.
