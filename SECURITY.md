# Security

SpeedZone Motorsports consists of a public Next.js application and a separately deployable `security-console/` application. The root application includes admin authentication, inventory mutations, test-drive submissions, uploads, rate limiting, and security-event logging. The security console is a separate read-only event-viewing application, but its independent authentication and authorization flow is not operational in the current source.

## Root application security model

The root application uses an initial `SPEEDZONE_ADMIN_PASSWORD` bootstrap path when no current credential exists. It hashes the bootstrap password with Argon2id, stores authentication state in Upstash Redis, and uses credential epochs, randomized and hashed server-side sessions, idle and absolute session expiration, session-generation invalidation, rate limiting, and WebAuthn/passkeys with user verification required.

Inventory mutations require admin authorization. Inventory photos use validated paths and an explicitly configured `INVENTORY_BLOB_ORIGIN`; image proxying validates the expected Blob origin and supported image formats. Test-drive submissions reach the server in plaintext, are validated and rate limited, then are encrypted server-side with AES-256-GCM using `TEST_DRIVE_ENCRYPTION_KEY` and stored in private Vercel Blob objects. Authenticated admin functionality decrypts them server-side. This is application-layer encryption at rest, not browser-only, zero-knowledge, or end-to-end encryption.

If configured, Resend notification email may include test-drive information. Do not add service secrets to browser code or commit environment files.

## Security events

`src/lib/security-events.ts` provides typed event categories, event IDs, request correlation IDs, ISO timestamps, outcome and actor classification, route and method information, bounded metadata, prohibited-field filtering, deterministic canonical serialization, SHA-256 hashes for individual events, and individual-event hash verification.

The event structure has an optional `previousHash`, but the current application does not implement a globally serialized hash chain or automatically populate a trustworthy previous hash for every event. This repository does not establish Merkle roots, AWS KMS signing, S3 Object Lock, a WORM archive, or a provisioned Vercel Drain.

When `SECURITY_LOG_PROVIDER=axiom` and the ingest URL and token are configured, `writeSecurityEvent()` supports best-effort Axiom-style HTTP ingestion. Logging delivery is fail-open with respect to the business request; a logging failure does not block the request. Not every possible security decision is necessarily instrumented.

See [`docs/security-logging.md`](docs/security-logging.md) for the current logging notes and residual risks.

## Security console status

`security-console/` has separate Redis configuration names, security headers, read-only recent-event and individual-event views, an integrity-status page, and login/setup/passkey UI surfaces. It fails closed when the security event store cannot be read.

Its independent Redis configuration is:

```text
SECURITY_KV_REST_API_URL
SECURITY_KV_REST_API_TOKEN
```

The current login, setup, and passkey pages explicitly state that security-console authentication is not yet operational. The console is not currently protected by an independent WebAuthn passkey. The separate application boundary and variable names alone do not establish cryptographic isolation from inventory-admin credentials.

The intended variables `SECURITY_WEBAUTHN_RP_ID`, `SECURITY_WEBAUTHN_ORIGIN`, and `SECURITY_BOOTSTRAP_TOKEN` do not represent a completed WebAuthn/session/bootstrap implementation in the current source. Do not expose the console publicly until that independent authentication and authorization layer is completed and verified. The event API must not be treated as authenticated merely because it resides under a separate deployment.

## Target deployment boundary

The intended deployment boundary is:

- Primary application: normal SpeedZone deployment with inventory/admin Redis and inventory-admin credentials.
- Security console: separate Vercel deployment at `logs.speedzonems.com`, separate Redis, separate WebAuthn RP, separate passkeys, and read-only security-log access.
- External logging/integrity infrastructure: Axiom or Vercel Drain, immutable archival storage, Merkle roots, and signing with a key outside the application runtime.

External Vercel Drain, Axiom, S3 Object Lock, KMS signing, DNS, alerting, and retention controls are not provisioned by this repository merely because they appear in architecture documentation. Configure and verify those controls independently.

## Configuration handling

Keep confidential values server-side and rotate them through the deployment secret manager. Relevant root-application names include `TEST_DRIVE_ENCRYPTION_KEY`, `SPEEDZONE_ADMIN_PASSWORD`, `INVENTORY_BLOB_ORIGIN`, `SECURITY_LOG_PROVIDER`, `SECURITY_LOG_INGEST_URL`, `SECURITY_LOG_INGEST_TOKEN`, the root Redis variables, Blob tokens, Resend variables, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID`. The security console has separate Redis, WebAuthn, bootstrap, and provider configuration names.

RP IDs and origins are identifiers/configuration, not secrets. Redis tokens, Blob tokens, Resend API keys, ingest credentials, bootstrap tokens, and encryption keys are confidential. Never publish their values in source, issues, logs, screenshots, or documentation.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Include the affected route or component, reproduction steps, impact, and relevant timestamps without including secret values or personal test-drive data. If a credential or token may have been exposed, revoke or rotate it at the provider, replace it in the deployment secret manager, redeploy, and review recent usage.
