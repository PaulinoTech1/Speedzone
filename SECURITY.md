# Security

SpeedZone Motorsports consists of a public Next.js application and a security console that is currently mounted at `/Security_Console`. A separately deployable copy remains in `security-console/` for the planned isolated rollout. The root application includes admin authentication, inventory mutations, test-drive submissions, uploads, rate limiting, and security-event logging. In either location, the security console uses an independent password, WebAuthn passkeys, Redis sessions, rate-limit namespace, and host-only cookie.

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

`/Security_Console` is the current security and operations control plane, with `security-console/` retaining the deployable equivalent. It has separate Redis configuration, password credentials, WebAuthn passkeys, sessions, cookie, rate-limit namespace, console audit records, and security headers. It exposes read-only views for administrator access, credential history, inventory activity, customer-request delivery, event integrity, configuration status, active console sessions, and encrypted bug reports. It fails closed when authentication storage or a required provider cannot be read.

Its independent Redis configuration is:

```text
ADMIN_SECURITY_KV_REST_API_URL
ADMIN_SECURITY_KV_REST_API_TOKEN
```

The console uses the writable `ADMIN_SECURITY_KV_REST_API_URL` and `ADMIN_SECURITY_KV_REST_API_TOKEN` pair. Provider-created read-only and TCP connection variables are not used because credentials, sessions, challenges, audit records, replay records, and rate-limit counters require writes. The one-time setup exchanges `SECURITY_BOOTSTRAP_TOKEN` for an Argon2id password record in the console Redis. A password session can enroll or authenticate a passkey; operational pages and APIs require the upgraded MFA session. Sessions have four-hour absolute and fifteen-minute idle expiry, support revocation, are indexed for authenticated visibility, and use the `__Host-speedzone_security` Secure, HTTP-only, SameSite=Strict cookie. The inventory cookie is not inspected or accepted.

For the embedded route, `EMBEDDED_SECURITY_WEBAUTHN_ORIGIN=https://www.speedzonems.com` and `EMBEDDED_SECURITY_WEBAUTHN_RP_ID=www.speedzonems.com` override the standalone WebAuthn values. Keep `NEXT_PUBLIC_SECURITY_CONSOLE_URL=/Security_Console` until the isolated console is deployed. The primary Vercel project must also have the console Redis, bootstrap, provider-query, delivery-test, and console IP-hash variables because the embedded server routes consume them directly.

When the versioned password record is absent, a successful verification of the original Security Console password creates the versioned record with the current Argon2id parameters. This migration never accepts the inventory-admin password and does not copy WebAuthn credentials across relying-party domains. A passkey enrolled for `logs.speedzonems.com` cannot authenticate an origin at `www.speedzonems.com`; the operator must enroll a new passkey after the migrated password is accepted.

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
- Security console: separate Vercel deployment at `logs.speedzonems.com`, separate Redis, separate WebAuthn RP, separate passkeys, and read-only security-log access.
- External logging/integrity infrastructure: Axiom or Vercel Drain, immutable archival storage, Merkle roots, and signing with a key outside the application runtime.

External Vercel Drain, Axiom, S3 Object Lock, KMS signing, DNS, alerting, and retention controls are not provisioned by this repository merely because they appear in architecture documentation. Configure and verify those controls independently.

## Configuration handling

Keep confidential values server-side and rotate them through the deployment secret manager. Relevant root-application names include `TEST_DRIVE_ENCRYPTION_KEY`, `SPEEDZONE_ADMIN_PASSWORD`, `BLOB_READ_WRITE_TOKEN`, `TEST_DRIVE_BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, `SECURITY_LOG_PROVIDER`, `SECURITY_LOG_INGEST_URL`, `SECURITY_LOG_INGEST_TOKEN`, the Redis variables, Resend variables, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID`. `INVENTORY_BLOB_ORIGIN` is retained only as a legacy fallback; the inventory upload store is derived from the store identifier embedded in `BLOB_READ_WRITE_TOKEN` when available. The security console has separate Redis, WebAuthn, bootstrap, and provider configuration names.

Security Console configuration additionally includes `ADMIN_SECURITY_KV_REST_API_URL`, `ADMIN_SECURITY_KV_REST_API_TOKEN`, `SECURITY_WEBAUTHN_ORIGIN`, `SECURITY_WEBAUTHN_RP_ID`, `SECURITY_BOOTSTRAP_TOKEN`, `SECURITY_LOG_QUERY_URL`, `SECURITY_LOG_QUERY_TOKEN`, `SECURITY_TEST_TARGET_URL`, `SECURITY_CONSOLE_TEST_SECRET`, `SECURITY_CONSOLE_SERVICE_SECRET`, `SPEEDZONE_SOURCE_URL`, and `SECURITY_CONSOLE_IP_HASH_SECRET`.

RP IDs, origins, source URLs, store IDs, and webhook public keys are identifiers or verification configuration, not upload credentials. Redis tokens, Blob read/write tokens, Resend API keys, ingest/query credentials, bootstrap tokens, HMAC secrets, IP-hashing keys, and encryption keys are confidential. Never publish their values in source, issues, logs, screenshots, or documentation. Configuration-health interfaces may report only `SET` or `MISSING` and must never return secret contents.

## Reportable findings and severity context

Treat authentication bypass, cross-credential acceptance, unauthorized inventory mutation, private report or customer-data disclosure, server-side request-signature bypass, WebAuthn verification bypass, session fixation, recovery-token replay, secret exposure, unrestricted upload, and encryption-key misuse as reportable findings. Severity depends on realistic reachability and impact; internet-reachable administrative or customer-data compromise is normally high or critical. Missing cosmetic hardening without a plausible security impact should not be represented as equivalent to an authorization or data-confidentiality failure.

## Known limitations

Individual event hashes detect modification when the trusted original hash is available, but they do not establish a serialized hash chain or immutable archive. Automated alerting, external WORM storage, KMS signing, and provider retention controls require separate deployment configuration. The console currently provides data visibility; workflow features such as report assignment, internal notes, and automated alarms are separate work.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Include the affected route or component, reproduction steps, impact, and relevant timestamps without including secret values or personal test-drive data. If a credential or token may have been exposed, revoke or rotate it at the provider, replace it in the deployment secret manager, redeploy, and review recent usage.
