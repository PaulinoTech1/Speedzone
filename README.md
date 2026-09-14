# SpeedZone Motorsports

SpeedZone Motorsports is a Next.js 16 dealership application with a public-facing motorsports site and a separately deployable security-console application under `security-console/`.

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

`src/lib/security-events.ts` defines the current security event system. It provides:

- Typed security-event categories
- Generated event IDs
- Request correlation IDs
- ISO timestamps
- Outcome and actor classification
- Route and method information
- Bounded metadata
- Prohibited-field filtering
- Deterministic canonical serialization
- SHA-256 hashes for individual events
- Verification of individual event hashes

The event structure has an optional `previousHash` field, but the current application does not implement a globally serialized hash chain or automatically populate a trustworthy previous hash for every event. The repository does not establish Merkle roots, AWS KMS signing, S3 Object Lock, a WORM archive, or a provisioned Vercel Drain.

`writeSecurityEvent()` supports best-effort Axiom-style HTTP ingestion when `SECURITY_LOG_PROVIDER=axiom` and the ingest URL and token are configured. The delivery path is fail-open with respect to the business request: logging failures do not block the request. Not every possible security decision is necessarily instrumented yet.

See [`docs/security-logging.md`](docs/security-logging.md) for additional architectural notes.

## Security console

`security-console/` is a separately deployable Next.js application with its own package manifest, security Redis configuration names, security headers, and read-only security-event UI. It currently includes:

- Read-only recent-event UI
- Individual event viewing
- Integrity-status page
- Login, setup, and passkey UI surfaces
- Fail-closed behavior when the security event store cannot be read

The console uses independent Redis configuration variables:

```text
SECURITY_KV_REST_API_URL
SECURITY_KV_REST_API_TOKEN
```

The security console has an independent Argon2id password bootstrap, passkey registration and login, session cookie, credential epoch, Redis namespace, and WebAuthn RP configuration. It never reads inventory-admin cookies, credentials, passkeys, or Redis keys. The event API and all event pages require the security-console session.

Configure `SECURITY_WEBAUTHN_RP_ID`, `SECURITY_WEBAUTHN_ORIGIN`, and `SECURITY_BOOTSTRAP_TOKEN` only in the security-console deployment. Bootstrap once, sign in with the independent password, and register at least one security-console passkey before removing or rotating the bootstrap token.

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
WEBAUTHN_ORIGIN
WEBAUTHN_RP_ID
SPEEDZONE_E2E
INVENTORY_E2E_FIXTURE
```

The `KV_REST_API_*` variables are the canonical Redis names in the root application; the `UPSTASH_REDIS_REST_*` names are supported as fallbacks for test-drive rate limiting. `TEST_DRIVE_BLOB_READ_WRITE_TOKEN` is preferred for test-drive storage, with `BLOB_READ_WRITE_TOKEN` supported as a fallback on the public submission route.

### Security console

The separately deployable console references or is intended to use:

```text
SECURITY_KV_REST_API_URL
SECURITY_KV_REST_API_TOKEN
SECURITY_WEBAUTHN_ORIGIN
SECURITY_WEBAUTHN_RP_ID
SECURITY_BOOTSTRAP_TOKEN
SECURITY_LOG_PROVIDER_URL
SECURITY_LOG_PROVIDER_TOKEN
```

`SECURITY_WEBAUTHN_RP_ID` and the origin are identifiers/configuration values. Redis tokens, bootstrap tokens, provider tokens, and other credentials are confidential and must remain server-side.

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

Deploy the root directory as a Next.js project on Vercel using the repository's npm lockfile and `npm run build`. Deploy `security-console/` as a separate Next.js project only after its independent authentication and authorization layer is implemented and verified.

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
