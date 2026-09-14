# SpeedZone Motorsports

SpeedZone Motorsports is a Next.js 16 dealership application with a public-facing motorsports site and a separately deployable security operations console in `security-console/`. The embedded `/Security_Console` pages and `/api/security-console` endpoints have been removed.

The root application uses Next.js 16, React 19, Node.js 22, TypeScript, Vercel Blob, Upstash Redis, SimpleWebAuthn, Argon2id, Resend, Vitest, and Playwright. These services support the application architecture rather than representing a generic dependency list: Blob stores inventory and private test-drive objects, Redis stores authentication and rate-limit state, SimpleWebAuthn provides passkeys, Argon2id hashes the bootstrap password, Resend sends configured notifications and recovery messages, and Vitest/Playwright cover unit and browser behavior.

## Project functionality

The public site currently includes:

- Dealership marketing pages
- Inventory listing and vehicle photo display
- Buying-cost calculator
- NHTSA recall information and linking
- Road-trip content
- Sell-your-car page
- Test-drive submission
- Privacy and terms pages

The root application also provides an admin surface at `/admin` with:

- Inventory management
- Inventory photo upload
- Inventory creation, update, and deletion
- Admin test-drive request viewing
- Admin authentication
- WebAuthn/passkeys
- Password bootstrap and credential storage
- Password recovery
- Rate limiting

## Admin authentication architecture

The root application supports an initial `SPEEDZONE_ADMIN_PASSWORD` bootstrap path when no current admin credential exists. The password is hashed with Argon2id and the resulting credential state is stored in Upstash Redis.

After passkey enrollment, admin authentication uses WebAuthn/passkeys with user verification required. The implementation tracks credential epochs, uses randomized and hashed server-side sessions, supports idle and absolute session expiration, and can invalidate sessions through session-generation changes. Login, passkey-option, recovery, and related paths are rate limited. Password recovery is bound to the current credential epoch so a credential change invalidates recovery material associated with an earlier epoch.

A password bootstrap value is a setup mechanism; it should not be described as the complete steady-state authentication method after passkey enrollment.

## Inventory architecture

Inventory metadata is stored in Vercel Blob as:

```text
inventory/inventory.json
```

Inventory photos are stored in the configured public Vercel Blob store. Inventory mutations require admin authorization. Upload paths are validated, and inventory-photo operations are constrained by the explicitly configured `INVENTORY_BLOB_ORIGIN`. The image proxy validates the expected Blob origin and supported image formats. Upload size, type, and count constraints are enforced.

Vercel Blob is object storage for this feature; it is not used as a relational database.

## Test-drive data

Test-drive submissions reach the server in plaintext so they can be validated and rate limited. The application then encrypts the submission server-side with AES-256-GCM and stores the encrypted data in private Vercel Blob objects. Authenticated admin functionality decrypts the data server-side when it is viewed.

The encryption key is supplied through:

```text
TEST_DRIVE_ENCRYPTION_KEY
```

This is application-layer server-side encryption at rest. It is not zero-knowledge, browser-only encryption, client-side encryption, or end-to-end encryption because the server receives the plaintext and possesses the decryption key.

When Resend notification configuration is enabled, the application may also include test-drive information in a notification email.

## Security event logging

`src/lib/security-events.ts` defines the versioned security event system. It provides:

- Typed security-event categories
- Generated event IDs
- Request correlation IDs
- ISO timestamps
- Outcome and actor classification
- Route and method information
- Privacy-safe administrator network fingerprints
- Approximate Vercel country/region context
- Sanitized browser and operating-system families
- Bounded metadata
- Prohibited-field filtering
- Deterministic canonical serialization
- SHA-256 hashes for individual events
- Verification of individual event hashes

The event structure has an optional `previousHash` field, but the current application does not implement a globally serialized hash chain or automatically populate a trustworthy previous hash for every event. The repository does not establish Merkle roots, AWS KMS signing, S3 Object Lock, a WORM archive, or a provisioned Vercel Drain.

Raw IP addresses and complete user-agent strings are not written to application security events. Network context is added only to administrator and inventory-security events, using a keyed HMAC supplied through `SECURITY_IP_HASH_SECRET`. Public test-drive and bug-report events do not receive this client fingerprint.

`writeSecurityEvent()` supports best-effort Axiom-style HTTP ingestion when `SECURITY_LOG_PROVIDER=axiom` and the ingest URL and token are configured. The delivery path is fail-open with respect to the business request: logging failures do not block the request. Authentication, credential, inventory, report-receipt, customer-request, and notification-delivery outcomes are instrumented.

See [`docs/security-logging.md`](docs/security-logging.md) for additional architectural notes.

## Security console

The separately deployable application in `security-console/` is the only security console. It uses its own Redis database, password, passkeys, sessions, cookie, rate limits, audit records, security headers, and read-only operational UI. It includes:

- Risk-focused overview metrics
- Administrator access and credential history
- Inventory activity and catalog revision visibility
- Customer-request and notification-delivery health
- Privacy-safe network and client context
- Independent console-login history and active-session visibility
- Paginated encrypted bug and security reports
- Configuration health reported only as `SET` or `MISSING`
- Read-only recent-event and individual-event views
- Individual event viewing
- Integrity checks and a controlled delivery test
- Independent password, setup, passkey, and MFA session flows
- Fail-closed behavior when the security event store cannot be read

The console uses independent Redis configuration variables:

```text
ADMIN_SECURITY_KV_REST_API_URL
ADMIN_SECURITY_KV_REST_API_TOKEN
```

`SECURITY_KV_REST_API_URL` and `SECURITY_KV_REST_API_TOKEN` remain supported aliases. The writable REST token is required because console credentials, sessions, WebAuthn challenges, audit records, and rate-limit counters require writes. Provider-generated read-only and TCP variables do not replace this pair.

The public footer points to `https://www.speedzonems.com/Security_Console`. Routing that path to the preserved separate console is pending; the embedded implementation has been removed. The previously proposed `logs.speedzonems.com` hostname is not provisioned. The primary application retains the signed internal report and delivery-test endpoints used by the console.

The one-time `SECURITY_BOOTSTRAP_TOKEN` initializes an Argon2id password in the console Redis. A password-authenticated session must be upgraded with the console's independent WebAuthn passkey before operational pages and APIs can be read. Console sessions have four-hour absolute and fifteen-minute idle expiry and use the `__Host-speedzone_security` Secure, HTTP-only, SameSite=Strict cookie. The inventory-admin cookie and credentials are never accepted by the console.

Private bug reports remain encrypted in the primary application's Redis. The console reads them through a narrow server-to-server endpoint authenticated with a timestamped HMAC using `SECURITY_CONSOLE_SERVICE_SECRET`. The shared secret stays server-side, report responses are non-cacheable, and inventory mutation is not exposed through this bridge.

## Target architecture

The following is a deployment target, not a claim about controls currently provisioned by this repository.

**Primary application**

- Normal SpeedZone deployment
- Inventory/admin Redis
- Inventory admin credentials

**Security console**

- Separate Vercel deployment
- `logs.speedzonems.com`
- Separate Redis
- Separate WebAuthn RP
- Separate passkeys
- Read-only security-log access

**External logging and integrity infrastructure**

- Axiom or Vercel Drain
- Immutable archival storage
- Merkle roots
- Signing with a key outside the application runtime

External Vercel Drain, Axiom, S3 Object Lock, KMS signing, DNS, alerting, and retention controls are not provisioned by this repository merely because they appear in architecture documentation. They must be configured and verified independently.

## Environment configuration

Never commit secret values. Configuration is deployment-specific; the following names describe the categories consumed or referenced by the current source.

### Main application

Core application configuration includes:

```text
TEST_DRIVE_ENCRYPTION_KEY
SPEEDZONE_ADMIN_PASSWORD
INVENTORY_BLOB_ORIGIN
SECURITY_LOG_PROVIDER
SECURITY_LOG_INGEST_URL
SECURITY_LOG_INGEST_TOKEN
SECURITY_IP_HASH_SECRET
SECURITY_CONSOLE_SERVICE_SECRET
```

The root application also consumes or supports the following service variables:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
TEST_DRIVE_BLOB_READ_WRITE_TOKEN
BLOB_READ_WRITE_TOKEN
RESEND_API_KEY
RESEND_EMAIL_DOMAIN
RESEND_PASSWORD_RESET_API_KEY
TEST_DRIVE_NOTIFICATION_EMAIL
ADMIN_RECOVERY_EMAIL
WEBAUTHN_ORIGIN
WEBAUTHN_RP_ID
BUG_REPORT_ORIGIN
BUG_REPORT_ENCRYPTION_KEY
BUG_REPORT_RATE_LIMIT_SECRET
SPEEDZONE_E2E
INVENTORY_E2E_FIXTURE
```

The `KV_REST_API_*` variables are the canonical Redis names in the root application; the `UPSTASH_REDIS_REST_*` names are supported as fallbacks for test-drive rate limiting. `TEST_DRIVE_BLOB_READ_WRITE_TOKEN` is preferred for test-drive storage, with `BLOB_READ_WRITE_TOKEN` supported as a fallback on the public submission route.

### Security console

The separately deployable console references or is intended to use:

```text
ADMIN_SECURITY_KV_REST_API_URL
ADMIN_SECURITY_KV_REST_API_TOKEN
SECURITY_WEBAUTHN_ORIGIN
SECURITY_WEBAUTHN_RP_ID
SECURITY_BOOTSTRAP_TOKEN
SECURITY_LOG_PROVIDER
SECURITY_LOG_QUERY_URL
SECURITY_LOG_QUERY_TOKEN
SECURITY_TEST_TARGET_URL
SECURITY_CONSOLE_TEST_SECRET
SECURITY_CONSOLE_SERVICE_SECRET
SPEEDZONE_SOURCE_URL
SECURITY_CONSOLE_IP_HASH_SECRET
```

`SECURITY_WEBAUTHN_RP_ID`, `SECURITY_WEBAUTHN_ORIGIN`, and `SPEEDZONE_SOURCE_URL` are configuration values. Redis tokens, bootstrap tokens, provider tokens, shared HMAC secrets, and hashing keys are confidential and must remain server-side.

### Generating Base64URL secrets

These secrets are generated application values, not Marketplace integrations. Generate each value in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

Use separate generated values for `SECURITY_IP_HASH_SECRET` and `SECURITY_CONSOLE_IP_HASH_SECRET`. Generate `SECURITY_CONSOLE_SERVICE_SECRET` once and place the identical value in the primary and Security Console Vercel projects for the corresponding environment. Preview and Production should use separate values. Changing an IP-hashing secret breaks continuity between earlier and later network fingerprints.

## Development

From the repository root:

```bash
npm ci
npm run dev
```

The root development server runs at `http://localhost:4173`.

The separate console can be developed from `security-console/` with its own npm manifest:

```bash
npm ci
npm run dev
```

Its development server runs on port `4190`.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The root `npm run check` script runs linting, type checking, tests, and a production build.

## Deployment

Deploy the root directory as one Next.js project on Vercel using the repository's npm lockfile and `npm run build`. Deploy `security-console/` as a separate Next.js project with its Root Directory set to `security-console`. Configure Preview first, enroll an independent console password and passkey, verify every protected page and API, run the controlled delivery test, and confirm report access before configuring `logs.speedzonems.com` for Production.

## Repository layout

```text
src/                 Root SpeedZone Next.js application
security-console/    Separately deployable security-console Next.js application
docs/                Architecture and operational notes
tests/               Root application tests
```

The application does not provision external archival, key-management, DNS, alerting, or retention infrastructure. Those operational controls require separate configuration and verification.

## License and security reports

Keep dependency and deployment configuration current. Report security concerns privately to the repository owner rather than publishing sensitive details.
