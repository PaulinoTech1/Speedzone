# Security

SpeedZone Motorsports serves the public dealership site and the security console at `https://www.speedzonems.com/Security_Console`. Thin route files under `src/app/Security_Console/` mount the single console implementation in `security-console/`. The console retains independent password and passkey authentication, Redis sessions, and its own host-only session cookie.

## Root application security model

The root application uses `SPEEDZONE_ADMIN_PASSWORD` as the password bootstrap path when no current credential exists. The password is hashed with Argon2id; authentication state, credential epochs, session generations, and server-side sessions are stored in Redis. Sessions use randomized tokens, hashed Redis keys, absolute and idle expiration, generation-based revocation, and route-level authorization checks. Login and recovery endpoints are rate limited. WebAuthn/passkeys are supported as an additional authentication method, but a passkey is not required for the password-authenticated admin to use inventory administration.

Public inventory reads are intentionally available to website visitors. Inventory mutations, private administrative reads, and photo uploads require an authenticated admin session. The inventory upload flow uses a short-lived Vercel Blob client token generated server-side, sends the HTTP-only admin cookie with the token request, and uploads only validated inventory photo paths. Accepted image formats are JPEG/JPG, PNG, and WebP, with size and count limits; returned Blob URLs are checked against the Blob store associated with `BLOB_READ_WRITE_TOKEN`, using case-insensitive hostname comparison. `BLOB_STORE_ID` is an identifier only and is not an upload credential. Inventory photo proxying validates the store, path, and image response before serving it.

Test-drive submissions reach the server in plaintext, are validated and rate limited, then are encrypted server-side with AES-256-GCM using `TEST_DRIVE_ENCRYPTION_KEY` and stored in private Vercel Blob objects. Authenticated admin functionality decrypts them server-side. This is application-layer encryption at rest, not browser-only, zero-knowledge, or end-to-end encryption.

If configured, Resend notification email may include test-drive information. Do not add service secrets to browser code or commit environment files.

## Security events and administrative telemetry

`src/lib/security-events.ts` provides versioned event categories, event IDs, request correlation IDs, ISO timestamps, outcome and actor classification, route and method information, bounded metadata, prohibited-field filtering, deterministic canonical serialization, SHA-256 hashes for individual events, and individual-event hash verification. Authentication, credential, inventory, report-receipt, customer-request, and notification outcomes have distinct event reasons or categories.

Administrative and inventory-security events may include a truncated HMAC network fingerprint, approximate Vercel country/region headers, and a reduced browser/operating-system family. `SECURITY_IP_HASH_SECRET` keys the fingerprint. Raw IP addresses and complete user-agent strings must not be written to application security events. Public test-drive and bug-report events must not receive administrative client fingerprints.

The event structure has an optional `previousHash`, but the current application does not implement a globally serialized hash chain or automatically populate a trustworthy previous hash for every event. This repository does not establish Merkle roots, AWS KMS signing, S3 Object Lock, a WORM archive, or a provisioned Vercel Drain.

When `SECURITY_LOG_PROVIDER=axiom` and the ingest URL and token are configured, `writeSecurityEvent()` supports best-effort Axiom-style HTTP ingestion. Logging delivery is fail-open with respect to the business request; a logging failure does not block the request. Not every possible security decision is necessarily instrumented.

See [`docs/security-logging.md`](docs/security-logging.md) for the current logging notes and residual risks.

## Security console status

`security-console/` is the shared security and operations implementation mounted at `/Security_Console` in the primary deployment. It has separate Redis configuration, password credentials, WebAuthn passkeys, sessions, cookie, rate-limit namespace, console audit records, and security headers. It exposes read-only views for administrator access, credential history, inventory activity, customer-request delivery, event integrity, configuration status, active console sessions, and encrypted bug reports. It fails closed when authentication storage or a required provider cannot be read.

Its independent Redis configuration is:

```text
ADMIN_SECURITY_KV_REST_API_URL
ADMIN_SECURITY_KV_REST_API_TOKEN
```

The console uses the writable `ADMIN_SECURITY_KV_REST_API_URL` and `ADMIN_SECURITY_KV_REST_API_TOKEN` pair. Provider-created read-only and TCP connection variables are not used because credentials, sessions, challenges, audit records, replay records, and rate-limit counters require writes. Public setup endpoints are removed. A password session can only authenticate an established passkey; passkey management and all operational pages/APIs require assertion-backed MFA. Registration cannot elevate a session. Older MFA sessions without assertion evidence are rejected and require a new password/passkey login. Elevation atomically checks the original session, verified credential epoch, generation, and expiry before rotating the cookie. Sessions have four-hour absolute and fifteen-minute idle expiry, support revocation, are indexed for authenticated visibility, and use the `__Host-speedzone_security` Secure, HTTP-only, SameSite=Strict cookie. The inventory cookie is not inspected or accepted.

The public footer points to `https://www.speedzonems.com/Security_Console`. Pages and browser APIs are mounted below `/Security_Console`; the deleted `/api/security-console` APIs remain absent. Set the console Redis and WebAuthn variables on the primary project. `EMBEDDED_SECURITY_WEBAUTHN_ORIGIN=https://www.speedzonems.com` and `EMBEDDED_SECURITY_WEBAUTHN_RP_ID=www.speedzonems.com` are supported mount-specific overrides; standalone builds continue to use `SECURITY_WEBAUTHN_ORIGIN` and `SECURITY_WEBAUTHN_RP_ID`. Existing console credentials are retained; old MFA sessions without assertion evidence must sign in again. Legacy passwords are migrated only after successful verification. The internal signed report and delivery-test endpoints remain available.

The event reader uses the configured external provider query API. Console Redis is used for console credentials, sessions, challenges, audit records, and rate limits. Delivery testing is server-to-server, signed with `SECURITY_CONSOLE_TEST_SECRET`, replay protected, and limited to two attempts per fifteen minutes. No ingest, query, Redis, bootstrap, or HMAC secret reaches the browser.

Encrypted bug reports are removed from the inventory-admin diagnostics response. The console reads them from the primary application through `/api/internal/security-console/reports`. Requests require a fresh timestamp and an HMAC bound to the HTTP method, path, and query using `SECURITY_CONSOLE_SERVICE_SECRET`. Responses are bounded, paginated, non-cacheable, and read-only. The identical service secret must exist in both Vercel projects for a matching environment; Preview and Production should use different values.

## Security invariants

- Every console operational page and API must validate the independent MFA session server-side. Proxy cookie-presence checks are only an early redirect and never sufficient authorization.
- Inventory-admin credentials, cookies, passkeys, Redis namespaces, and recovery material must never authenticate the Security Console.
- The Security Console may observe inventory activity but must not expose inventory mutation operations.
- Secret values, passwords, recovery tokens, WebAuthn assertions, cookies, customer form contents, raw IP addresses, and complete user-agent strings must not enter security events.
- Private test-drive data and bug reports must remain encrypted at rest and be decrypted only on an authorized server path.
- Signed internal requests must be time bounded and bound to their method and complete path. Internal endpoints must remain bounded and non-cacheable.
- Authentication and authorization storage failures must fail closed. Security-event delivery failures may not duplicate or fail a completed customer or inventory transaction.
- Credential epoch or session-generation changes must invalidate sessions created under older state.

## Target deployment boundary

The intended deployment boundary is:

- Primary application: normal SpeedZone deployment with inventory/admin Redis and inventory-admin credentials.
- Security console: `/Security_Console` in the primary deployment, independent Redis, password, passkeys and session cookie, with read-only security-log access. Sharing the origin does not provide cross-origin isolation from the inventory application.
- External logging/integrity infrastructure: Axiom or Vercel Drain, immutable archival storage, Merkle roots, and signing with a key outside the application runtime.

External Vercel Drain, Axiom, S3 Object Lock, KMS signing, DNS, alerting, and retention controls are not provisioned by this repository merely because they appear in architecture documentation. Configure and verify those controls independently.

## Configuration handling

Keep confidential values server-side and rotate them through the deployment secret manager. Relevant root-application names include `TEST_DRIVE_ENCRYPTION_KEY`, `SPEEDZONE_ADMIN_PASSWORD`, `BLOB_READ_WRITE_TOKEN`, `TEST_DRIVE_BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, `SECURITY_LOG_PROVIDER`, `SECURITY_LOG_INGEST_URL`, `SECURITY_LOG_INGEST_TOKEN`, the Redis variables, Resend variables, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID`. `INVENTORY_BLOB_ORIGIN` is retained only as a legacy fallback; the inventory upload store is derived from the store identifier embedded in `BLOB_READ_WRITE_TOKEN` when available. The security console has separate Redis, WebAuthn, bootstrap, and provider configuration names.

Security Console configuration additionally includes `ADMIN_SECURITY_KV_REST_API_URL`, `ADMIN_SECURITY_KV_REST_API_TOKEN`, `SECURITY_WEBAUTHN_ORIGIN`, `SECURITY_WEBAUTHN_RP_ID`, `SECURITY_BOOTSTRAP_TOKEN`, `SECURITY_LOG_QUERY_URL`, `SECURITY_LOG_QUERY_TOKEN`, `SECURITY_TEST_TARGET_URL`, `SECURITY_CONSOLE_TEST_SECRET`, `SECURITY_CONSOLE_SERVICE_SECRET`, `SPEEDZONE_SOURCE_URL`, and `SECURITY_CONSOLE_IP_HASH_SECRET`.

RP IDs, origins, source URLs, store IDs, and webhook public keys are identifiers or verification configuration, not upload credentials. Redis tokens, Blob read/write tokens, Resend API keys, ingest/query credentials, bootstrap tokens, HMAC secrets, IP-hashing keys, and encryption keys are confidential. Never publish their values in source, issues, logs, screenshots, or documentation. Configuration-health interfaces may report only `SET` or `MISSING` and must never return secret contents.

## Reportable findings and severity context

Treat authentication bypass, cross-credential acceptance, unauthorized inventory mutation, private report or customer-data disclosure, server-side request-signature bypass, WebAuthn verification bypass, session fixation, recovery-token replay, secret exposure, unrestricted upload, and encryption-key misuse as reportable findings. Severity depends on realistic reachability and impact; internet-reachable administrative or customer-data compromise is normally high or critical. Missing cosmetic hardening without a plausible security impact should not be represented as equivalent to an authorization or data-confidentiality failure.

## Known limitations

### Archive extraction dependencies

The root npm override requires `tar >=7.5.11 <8` for the Vercel CLI dependency tree (currently locked to 7.5.22). This includes upstream fixes for drive-relative hardlink and symlink traversal. `npm ci` runs `scripts/patch-tar.cjs` to add the project's stricter boundary contract to both CommonJS and ESM `Unpack` builds and route the default bundled exports through those builds.

The guard normalizes separators and removes drive/volume/root prefixes before checking traversal segments and resolved boundaries. It rejects `..` segments in entry paths and link targets, including otherwise internal parent-relative links, even with `preservePaths`. Rejected entries emit `ERR_TAR_PATH_TRAVERSAL` with the original `entryPath`, normalized extraction `targetCwd`, and message `Extraction path or link target attempts to escape target directory`. Root directory entries remain permitted. Upstream tar retains its filesystem symlink protections; lexical checks alone do not prevent filesystem races.

Do not use `--ignore-scripts` when installing the CLI dependencies if the custom error contract is required. The upstream patched version remains enforced by the lockfile/override independently of this hook. The hook fails if its expected source/exports change; review it and run `npx vitest run tests/tar-boundary.test.ts` when upgrading tar. Production-only installs without Vercel skip the hook.

Individual event hashes detect modification when the trusted original hash is available, but they do not establish a serialized hash chain or immutable archive. Automated alerting, external WORM storage, KMS signing, and provider retention controls require separate deployment configuration. The console currently provides data visibility; workflow features such as report assignment, internal notes, and automated alarms are separate work.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Include the affected route or component, reproduction steps, impact, and relevant timestamps without including secret values or personal test-drive data. If a credential or token may have been exposed, revoke or rotate it at the provider, replace it in the deployment secret manager, redeploy, and review recent usage.
