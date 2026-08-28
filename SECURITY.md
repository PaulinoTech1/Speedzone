# Security architecture

## Authentication

The fixed administrator identifier and encoded Argon2id password hash are provisioned offline and live in Vercel Production environment variables. The server resolves a versioned `UNCONFIGURED`, `BOOTSTRAP_READY`, `ACTIVE`, or `RECOVERY` lifecycle for every request. Missing configuration, malformed state, and unavailable storage fail closed. A normal password success is accepted only in `ACTIVE` and produces only a five-minute encrypted pre-authentication cookie. A complete session is issued only after a user-verified assertion from a stored passkey succeeds.

WebAuthn uses `@simplewebauthn/server` and `@simplewebauthn/browser`. Every ceremony receives a random challenge, explicit RP ID and allowed origins, `userVerification: "required"`, a five-minute encrypted ceremony cookie bound to the pre-auth/session identifier, and an atomic single-use consume marker in the `SEcure_Auth` database. Platform passkeys and external FIDO2 keys are both allowed. Only credential ID, public key, counter, transports, creation date, and operator label are persisted.

All authentication cookies use the `__Host-` prefix with `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`; no `Domain` attribute is set. Cookie encryption, signing, security correlation, and recovery-code hashing use domain-separated keys derived from one independent 32-byte `AUTH_COOKIE_SECRET`. Full sessions have a 15-minute idle limit, an eight-hour absolute limit, a random rotated identifier, and a server-side epoch. `ADMIN_DISABLED=true` invalidates authorization at the shared session-validation boundary.

Authentication metadata is authoritative in the `SEcure_Auth` Neon database (project `shy-sunset-14721124`) as a single `auth_state` row. Authorization reads that row directly over TLS; nothing is cached and no mirror is consulted. Mutations read the current row, validate the expected revision, and commit with `UPDATE ... WHERE revision = <expected>`, a single statement that is its own transaction and therefore atomic across every Function instance; bounded retries re-read and re-run the mutation, while stale expected revisions fail. Session epochs and nonzero authenticator counters cannot move backwards. One-time markers for ceremonies, step-up assertions, recovery, and bootstrap live in `auth_consume_markers`, where the composite primary key makes a replayed digest unable to insert a second row. The application issues no DDL and creates no tables from a request path: a missing schema fails closed as a configuration error.

Offline provisioning generates the Argon2id password hash, `AUTH_COOKIE_SECRET`, and a random 32-byte bootstrap token. Only the token's SHA-256 digest is configured. Setup verification hashes the submitted token, compares fixed-length digests in constant time, runs the Argon2id verification path, returns a generic authentication failure, and permits three attempts per rolling 30 minutes per pseudonymized Vercel IP and JA4 bucket in each Function instance.

Initial enrollment is exposed only in `BOOTSTRAP_READY` on the explicitly configured final HTTPS Production origin and RP ID. It is rejected on Preview and does not trust request host headers. Successful three-credential verification issues a separate five-minute encrypted bootstrap cookie with a random ID. That cookie authorizes only registration options/verification and cannot authorize inventory or account settings. Registration requires user presence and verification, binds a fresh challenge to that cookie and administrator, and conditionally changes the single record to `ACTIVE` with one credential, ten recovery-code hashes, a new epoch, and a new revision. Enrollment clears all auth cookies and creates no session. Remove `ADMIN_BOOTSTRAP_TOKEN_HASH` after activation; `ACTIVE` ignores it.

Recovery requires the password and one recovery code. Its first conditional write moves `ACTIVE` to `RECOVERY` and rotates the epoch, invalidating sessions. A user-verified replacement registration is then conditionally committed with `RECOVERY` changed back to `ACTIVE`, every old passkey replaced, another new epoch, and ten new code hashes. The selected old code disappears in that same record replacement; there is no consume-before-state-commit ambiguity. Plaintext new codes are returned once, all cookies are cleared, and a normal password-plus-passkey login is still required.

Later passkey registration and deletion require a complete session, the password, and a fresh assertion from an already registered passkey. The final five-minute management proof is versioned as password-and-passkey assurance; older passkey-only proof cookies are rejected.

## Inventory state

The complete inventory is authoritative in the deterministic private-Blob object `inventory/state-v1.json`. The intended store is `speedzone-blbob`, connected with the dedicated `BLOB_INVENTORY` prefix; its access mode must be independently confirmed as Private before production use. The application prefers a project-scoped OIDC credential with `BLOB_INVENTORY_STORE_ID` and accepts `BLOB_INVENTORY_READ_WRITE_TOKEN` for a legacy/static connection. The default `BLOB_STORE_ID`/`BLOB_READ_WRITE_TOKEN` connection is a fallback. None of these values is public or exposed through a `NEXT_PUBLIC_` variable.

Every inventory read bypasses the Blob CDN cache and validates the complete versioned schema. A mutation reads the current object and ETag, validates the expected inventory and vehicle revisions, enforces stock/VIN/slug uniqueness and status transitions, and writes the complete next state with `ifMatch`. A stale writer cannot silently replace a newer object; bounded conflicts require a reload or retry. This is object-level optimistic concurrency, not a relational transaction or a substitute for an external database at larger scale.

When the authoritative object is absent, an existing legacy `INVENTORY_GLOBAL_CONFIG` connection is read once and its `inventory_state_v1` value is used to create the Blob object with overwrite disabled. After creation, every inventory read and mutation uses Blob. Operators must compare schema version, revision, vehicle count, and status counts before removing the legacy connection. Deleting the authoritative object can cause stale or empty reseeding and is a data-loss incident, not a supported reset procedure.

## Passwords and local drafts

Server passwords use Argon2id and a random salt. The parser refuses hashes below 19,456 KiB memory, two iterations, and parallelism one. The provisioning script uses 65,536 KiB, three iterations, and parallelism one. A separate 256-bit pepper remains supported for existing peppered hashes. The cookie master secret and any configured pepper must be generated independently. The server validates canonical base64url encoding, a minimum decoded length of 32 bytes, and forbidden secret reuse; software cannot prove that operator-provided bytes were generated randomly.

The fixed administrator ID is trimmed, NFKC-normalized, and lowercased before comparison. It must be either a valid email address or a 3–254-character username containing only ASCII letters, digits, periods, underscores, and hyphens. Passwords are never trimmed, normalized, case-folded, escaped, filtered, or silently truncated. Login accepts at most 128 Unicode code points and 512 UTF-8 bytes; the local hash generator additionally requires a new password of at least 16 code points without composition rules.

Optional autosaved drafts are the only client-encrypted business data. They use IndexedDB, a separate passphrase that is never sent to the server, Argon2id key derivation, a unique vault salt, AES-256-GCM, a per-vault random nonce prefix plus monotonic counter, and record/schema additional authenticated data. The key exists only in module memory while unlocked. JavaScript memory cannot be reliably zeroized, and loss of the vault passphrase makes those local drafts unrecoverable.

## Request and browser controls

- Every state-changing endpoint checks an explicit allowed `Origin` and a sealed, flow-bound CSRF cookie/header token. Setup additionally requires the final configured Production HTTPS origin.
- Every admin data endpoint performs server-side session authorization; proxy routing is not trusted for authorization.
- The password endpoint accepts only a strict JSON object containing `adminId` and `password`, streams at most 4 KiB before parsing, rejects duplicate or prototype-pollution keys, and applies Zod bounds before Argon2 work.
- Vehicle descriptions and features are plain text. React escapes them; JSON-LD replaces `<` before insertion.
- A per-request nonce CSP protects page scripts. Admin-only CSP permits WebAssembly for local Argon2id and Blob workers; it does not allow general inline scripts.
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive Permissions Policy, admin `no-store`, and production-only HSTS are configured.
- Security logs contain event type, result, HMAC-truncated actor/client correlation, and safe record identifiers. They exclude passwords, challenges, cookies, recovery codes, complete credentials, and tokens.

## Photographs and audit

The browser decodes accepted JPEG/PNG/WebP input, applies decoded orientation, resizes to the configured bound, draws pixels onto a new canvas (dropping EXIF/GPS metadata), and encodes WebP. An authenticated server endpoint creates a short-lived private staging authorization without revealing the Blob token. Finalization reads through the server-owned private token, validates pathname ownership, declared content type, byte limit, and WebP structure, then fully decodes and freshly re-encodes the pixels server-side before writing a new immutable randomized public object.

Before a vehicle mutation, an append-only timestamped private-Blob JSON snapshot records actor, action, time, ID, before/after hashes, and the records. Blob credentials are never included.

## Operational requirements

1. Enable the proposed WAF rules only after the logging review in [docs/WAF.md](docs/WAF.md).
2. Register at least two passkeys and store recovery codes offline.
3. Remove `ADMIN_BOOTSTRAP_TOKEN_HASH` and the plaintext token immediately after confirming fresh login.
4. Keep Production and Preview on separate `SEcure_Auth` branches and separate Blob resources, each with its own credentials. Confirm that Production `speedzone-blbob` is Private and connected under the intended `BLOB_INVENTORY` prefix before migrating inventory. Initial enrollment is never permitted on Preview or random `*.vercel.app` URLs.
5. Run the protected deployed Argon2 benchmark and replace the password hash if parameters change.
6. Rotate `AUTH_COOKIE_SECRET`, any password pepper, the `SEcure_Auth` role password, static Blob tokens, and Vercel API credentials after suspected exposure. Prefer Vercel's short-lived OIDC credential for inventory. Cookie-secret rotation invalidates existing sealed cookies and changes recovery-code hashes, so it requires a reviewed recovery migration rather than an uncoordinated environment edit.
7. Review function/security logs, the `auth_state` row and its `updated_at`, `SEcure_Auth` connection and role activity, the authoritative inventory Blob object, Blob audit objects, WAF matches, and unexpected inventory changes. Keep Neon point-in-time restore enabled: it is the only rollback for the authentication record.

## Reporting

Do not include secrets, complete passkey responses, recovery codes, cookies, or customer data in a report. Record the affected route, UTC time, deployment identifier, expected/actual behavior, and sanitized reproduction steps. Immediately set `ADMIN_DISABLED=true` and redeploy if administrator access may be compromised.

## Validation boundary

Automated tests cover the behaviors named in the repository's test output; passing helper tests must not be treated as proof of every external-service integration. The browser suite uses a virtual authenticator and an explicit non-Vercel loopback test gate. Secure-cookie behavior on the final domain, a physical platform/external authenticator, `speedzone-blbob` private access, OIDC or token scoping, live inventory ETag behavior, the deployed `SEcure_Auth` connection, schema, and compare-and-swap behavior, the one-time authentication cutover, legacy inventory migration, deployment-environment gating, and production WAF enforcement must also be verified after deployment. The repository cannot prove a WAF rule, Vercel permission, storage connection, DNS setting, or deployed Argon2 timing.
