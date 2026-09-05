# Security architecture

## Authentication

The fixed administrator identifier and encoded Argon2id password hash are provisioned offline and live in Vercel Production environment variables. The server resolves a versioned `UNCONFIGURED`, `BOOTSTRAP_READY`, `ACTIVE`, or `RECOVERY` lifecycle for every request. Missing configuration, malformed state, and unavailable storage fail closed. A normal password success is accepted only in `ACTIVE` and produces only a five-minute encrypted pre-authentication cookie. A complete session is issued only after a user-verified assertion from a stored passkey succeeds.

WebAuthn uses `@simplewebauthn/server` and `@simplewebauthn/browser`. Every ceremony receives a random challenge, explicit RP ID and allowed origins, `userVerification: "required"`, a five-minute encrypted ceremony cookie bound to the pre-auth/session identifier, and an atomic single-use consume marker in the `SEcure_Auth` database. Platform passkeys and external FIDO2 keys are both allowed. Only credential ID, public key, counter, transports, creation date, and operator label are persisted.

All authentication cookies use the `__Host-` prefix with `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`; no `Domain` attribute is set. Cookie encryption, signing, security correlation, and recovery-code hashing use domain-separated keys derived from one independent 32-byte `AUTH_COOKIE_SECRET`. Full sessions have a 15-minute idle limit, an eight-hour absolute limit, a random rotated identifier, and a server-side epoch. `ADMIN_DISABLED=true` invalidates authorization at the shared session-validation boundary.

Authentication metadata is authoritative in the `SEcure_Auth` Neon database (project `shy-sunset-14721124`) as a single `auth_state` row. Authorization reads that row directly over TLS; nothing is cached and no mirror is consulted. Mutations read the current row, validate the expected revision, and commit with `UPDATE ... WHERE revision = <expected>`, a single statement that is its own transaction and therefore atomic across every Function instance; bounded retries re-read and re-run the mutation, while stale expected revisions fail. Session epochs and nonzero authenticator counters cannot move backwards. One-time markers for ceremonies, step-up assertions, recovery, and bootstrap live in `auth_consume_markers`, where the composite primary key makes a replayed digest unable to insert a second row. The application issues no DDL and creates no tables from a request path: a missing schema fails closed as a configuration error.

Offline provisioning generates the Argon2id password hash, `AUTH_COOKIE_SECRET`, and a random 32-byte bootstrap token. Only the token's SHA-256 digest is configured. Setup verification hashes the submitted token, compares fixed-length digests in constant time, runs the Argon2id verification path, returns a generic authentication failure, and permits three attempts per fixed 30-minute window per pseudonymized Vercel IP across Function instances. Production counters use atomic Neon updates with expiration; missing shared storage fails closed. User-Agent and JA4 are telemetry only. Local development counters expire and are capped at 10,000 keys.

Initial enrollment is exposed only in `BOOTSTRAP_READY` on the explicitly configured final HTTPS Production origin and RP ID. It is rejected on Preview and does not trust request host headers. Successful three-credential verification issues a separate five-minute encrypted bootstrap cookie with a random ID. That cookie authorizes only registration options/verification and cannot authorize inventory or account settings. Registration requires user presence and verification, binds a fresh challenge to that cookie and administrator, and conditionally changes the single record to `ACTIVE` with one credential, ten recovery-code hashes, a new epoch, and a new revision. Enrollment clears all auth cookies and creates no session. Remove `ADMIN_BOOTSTRAP_TOKEN_HASH` after activation; `ACTIVE` ignores it.

Recovery requires the password and one recovery code. Its first conditional write moves `ACTIVE` to `RECOVERY` and rotates the epoch, invalidating sessions. A user-verified replacement registration is then conditionally committed with `RECOVERY` changed back to `ACTIVE`, every old passkey replaced, another new epoch, and ten new code hashes. The selected old code disappears in that same record replacement; there is no consume-before-state-commit ambiguity. Plaintext new codes are returned once, all cookies are cleared, and a normal password-plus-passkey login is still required.

Later passkey registration and deletion require a complete session, the password, and a fresh assertion from an already registered passkey. The final five-minute management proof is versioned as password-and-passkey assurance; older passkey-only proof cookies are rejected.

## Inventory state

Each vehicle is its own document in a private Sanity dataset (`SANITY_PROJECT_ID`/`SANITY_DATASET`/`SANITY_API_TOKEN`, an Editor-scoped token — never a project-administration credential, never exposed through a `NEXT_PUBLIC_` variable). Reads use `useCdn: false` and `perspective: "raw"`, and every inventory query explicitly excludes `drafts.**`, so the app sees uncached published document IDs without draft shadows.

Stock number, VIN, and slug uniqueness has no native cross-document guarantee in Sanity. The application editor queries actual vehicle documents and creates a deterministic `vehicleLock` per unique key in the same all-or-nothing transaction as its write. Its updates also gate on Sanity `_rev`. The standalone Studio mirrors the field, uniqueness, status-transition, photo-count, and published-photo checks and replaces Publish with an action that advances the application version and timestamps. Studio validation/actions are client-side workflow controls, not a Content Lake constraint; direct API mutations can bypass them, and simultaneous writes across the two editors do not have one shared cross-client transaction.

This is a fresh Sanity-backed installation; there is no legacy migration path into it.

## Passwords and local drafts

Server passwords use Argon2id and a random salt. The parser refuses hashes below 19,456 KiB memory, two iterations, and parallelism one. The provisioning script uses 65,536 KiB, three iterations, and parallelism one. A separate 256-bit pepper remains supported for existing peppered hashes. The cookie master secret and any configured pepper must be generated independently. The server validates canonical base64url encoding, a minimum decoded length of 32 bytes, and forbidden secret reuse; software cannot prove that operator-provided bytes were generated randomly.

The fixed administrator ID is trimmed, NFKC-normalized, and lowercased before comparison. It must be either a valid email address or a 3–254-character username containing only ASCII letters, digits, periods, underscores, and hyphens. Passwords are never trimmed, normalized, case-folded, escaped, filtered, or silently truncated. Login accepts at most 128 Unicode code points and 512 UTF-8 bytes; the local hash generator additionally requires a new password of at least 16 code points without composition rules.

Optional autosaved drafts are the only client-encrypted business data. They use IndexedDB, a separate passphrase that is never sent to the server, Argon2id key derivation, a unique vault salt, AES-256-GCM, a per-vault random nonce prefix plus monotonic counter, and record/schema additional authenticated data. The key exists only in module memory while unlocked. JavaScript memory cannot be reliably zeroized, and loss of the vault passphrase makes those local drafts unrecoverable.

## Request and browser controls

- Every authenticated admin mutation checks an explicit allowed `Origin` and a sealed, flow-bound CSRF cookie/header token. Setup additionally requires the final configured Production HTTPS origin.
- Every admin data endpoint performs server-side session authorization; proxy routing is not trusted for authorization.
- The password endpoint accepts only a strict JSON object containing `adminId` and `password`, streams at most 4 KiB before parsing, rejects duplicate or prototype-pollution keys, and applies Zod bounds before Argon2 work.
- Vehicle descriptions and features are plain text. React escapes them; JSON-LD replaces `<` before insertion.
- A per-request nonce CSP protects page scripts. Admin-only CSP permits WebAssembly and `blob:` worker scripts, both needed only for the client-side Argon2id draft-vault key derivation; it does not allow general inline scripts.
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive Permissions Policy, admin `no-store`, and production-only HSTS are configured.
- Security logs contain event type, result, HMAC-truncated actor/client correlation, and safe record identifiers. They exclude passwords, challenges, cookies, recovery codes, complete credentials, and tokens.

## Photographs

In the application `/admin` path, the browser decodes accepted JPEG/PNG/WebP input, applies orientation, resizes it, redraws pixels to remove metadata, and encodes WebP. The authenticated endpoint then enforces a streaming byte cap and independently decodes and freshly re-encodes it before uploading only the verified buffer to Sanity.

The standalone Studio uses Sanity's authenticated native asset upload instead. Its schema suppresses original filenames, requests LQIP/palette metadata without EXIF/location extraction, and blocks publishing references over 4 MiB or 1600 pixels per side. Those checks do not rewrite the original asset bytes and schema validation can be bypassed by direct API clients; use the application uploader when byte-level metadata removal is required.

There is no separate audit trail in this version. Sanity's own per-document revision history (`_rev`) is the change record for every vehicle write.

The public Next.js image optimizer is temporarily disabled, and the image CSP permits only the configured Sanity project/dataset. Dependency patching and deployment-native library verification remain required; see [the remediation record](docs/SECURITY-REMEDIATION-2026-09-05.md). Sanity asset URLs are public even for private datasets: upload only photographs intended for public availability. Dataset visibility does not protect asset bytes.

## Operational requirements

1. Enable the proposed WAF rules only after the logging review in [docs/WAF.md](docs/WAF.md).
2. Register at least two passkeys and store recovery codes offline.
3. Remove `ADMIN_BOOTSTRAP_TOKEN_HASH` and the plaintext token immediately after confirming fresh login.
4. Keep Production and Preview on separate `SEcure_Auth` branches and separate Sanity datasets, each with its own credentials. Initial enrollment is never permitted on Preview or random `*.vercel.app` URLs.
5. Run the protected deployed Argon2 benchmark and replace the password hash if parameters change.
6. Rotate `AUTH_COOKIE_SECRET`, any password pepper, the `SEcure_Auth` role password, the Sanity API token, and Vercel API credentials after suspected exposure. Cookie-secret rotation invalidates existing sealed cookies and changes recovery-code hashes, so it requires a reviewed recovery migration rather than an uncoordinated environment edit.
7. Review function/security logs, the `auth_state` row and its `updated_at`, `SEcure_Auth` connection and role activity, Sanity's own document-revision history, WAF matches, and unexpected inventory changes. Keep Neon point-in-time restore enabled: it is the only rollback for the authentication record.

## Reporting

Do not include secrets, complete passkey responses, recovery codes, cookies, or customer data in a report. Record the affected route, UTC time, deployment identifier, expected/actual behavior, and sanitized reproduction steps. Immediately set `ADMIN_DISABLED=true` and redeploy if administrator access may be compromised.

## Validation boundary

Automated tests cover the behaviors named in the repository's test output; passing helper tests must not be treated as proof of every external-service integration. The tests mock the Sanity client at the module boundary, including a hand-simulated transaction that rejects a lock collision or a stale revision — this proves the application's own logic, not the deployed Sanity API's actual behavior. The browser suite uses a virtual authenticator and an explicit non-Vercel loopback test gate. Secure-cookie behavior on the final domain, a physical platform/external authenticator, the live Sanity dataset's actual transaction/uniqueness/revision behavior, the deployed `SEcure_Auth` connection, schema, and compare-and-swap behavior, the one-time authentication cutover, deployment-environment gating, and production WAF enforcement must also be verified after deployment. The repository cannot prove a WAF rule, Vercel permission, storage connection, DNS setting, or deployed Argon2 timing.
