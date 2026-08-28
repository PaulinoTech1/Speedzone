# Threat model

## Scope and assets

Protected assets are administrator credentials, passkey metadata, recovery-code hashes, session authority, unpublished inventory, vehicle mutations, private staging photographs, audit history, storage/API credentials, and the optional local draft key. Published inventory and public photos are intentionally public.

Trust boundaries are the public browser, admin browser, Vercel edge/WAF, Next.js Node Functions, the `SEcure_Auth` Neon database, the private inventory Blob, the private audit/staging Blob, the public-photo Blob, and the operator's Vercel/Neon/GitHub accounts.

## Adversaries

- Internet attacker guessing credentials, replaying ceremonies, submitting CSRF, flooding Argon2/WebAuthn routes, or probing uploads
- Authenticated attacker abusing a stolen session or unlocked browser
- Malicious inventory input attempting stored XSS or metadata smuggling
- Compromised deployment/runtime secret with access to storage or Vercel management APIs
- Operator error involving RP IDs, origins, storage environments, recovery materials, or publication states
- Supply-chain compromise of npm, GitHub, or the deployment pipeline

## Primary mitigations

| Threat | Mitigation |
| --- | --- |
| Password theft/guessing | Argon2id, optional pepper, fixed normalized identifier, WAF plus application limits, jittered delays, generic failures |
| Password-only bypass | Password creates only five-minute pre-auth; full session requires verified WebAuthn assertion |
| Host/Preview bootstrap | Setup requires the explicit final HTTPS origin, matching RP ID, `VERCEL_ENV=production`, and `BOOTSTRAP_READY`; request host headers are ignored |
| Challenge replay | Encrypted/bound ceremony cookie plus atomic immutable private-Blob consume marker burned before verification |
| Cross-site mutation | SameSite-Strict host cookies, exact Origin allowlist, sealed session-bound CSRF token |
| Session theft/persistence | HttpOnly/Secure cookies, 15-minute idle and eight-hour absolute limits, rotation, individual revocation, global epoch |
| Unauthorized passkey changes | Complete session plus password proof plus fresh assertion from an existing passkey; old passkey-only proof cookies are invalid; final passkey cannot be deleted |
| Lost authenticators | Ten 130-bit single-use offline codes; password plus code plus new user-verified passkey; all old keys/epochs replaced |
| Stored XSS | Plain text fields, Zod bounds, React escaping, safe JSON-LD encoding, nonce CSP |
| Photo polyglots/metadata | Canvas re-encode, private staging, strict owned path, server-side WebP decode and fresh re-encode with byte/dimension limits, immutable public destination |
| Inventory tampering | Authorization on every API, complete-schema validation, record and state revisions, uncached private-Blob reads, ETag conditional writes, uniqueness checks, private before-change audit snapshots |
| Distributed request flood | Proposed Vercel WAF IP+JA4 limits plus per-instance setup IP/JA4 and other client/subject limits |
| Local draft disclosure | Separate never-transmitted passphrase, Argon2id, AES-GCM, IndexedDB, AAD, unique nonces, memory-only key |

## Remaining risks and explicit limitations

1. **Inventory uses whole-object optimistic concurrency.** `inventory/state-v1.json` is read uncached and replaced only when its ETag matches, preventing a cooperating stale writer from silently overwriting a newer revision. Each mutation nevertheless reads, parses, validates, serializes, and writes the complete inventory. Bursts of concurrent edits can exhaust bounded retries and require an administrator reload. The protection depends on every writer using the same object and conditional-write protocol; direct control-plane edits or a stolen credential can bypass application uniqueness and transition checks. Live Vercel consistency, OIDC, and ETag behavior remains a deployment verification item, not a guarantee established only by unit mocks.
2. **Authentication availability now depends on `SEcure_Auth`.** Authentication state is read uncached from the single `auth_state` row and written with a `revision` compare-and-swap, so bootstrap activation is one revision-checked change and competing registrations cannot both activate. There is no mirror and no read replica: if the database is unreachable, or its schema has not been applied, every administrator request fails closed rather than degrading. That is the intended trade, but it makes Neon availability, connection limits, and point-in-time restore operational requirements. Live compare-and-swap and failure behavior remains a deployment verification item, not a guarantee established only by unit mocks.
3. **Runtime credential blast radius.** `AUTH_DATABASE_URL` carries a role password that can read and rewrite the whole authentication record, so it belongs only in Production as a Sensitive Environment Variable, on a role scoped to `SEcure_Auth` with no rights over other databases and no DDL beyond the migration role. A static Blob read-write token likewise permits object mutation or deletion within its store. Prefer project-scoped, short-lived OIDC for `speedzone-blbob`; otherwise use separate, narrowly scoped Production/Preview credentials, monitoring, and rotation.
4. **Rate-limit layers differ.** The setup Function enforces three attempts per rolling 30 minutes on pseudonymized Vercel IP and JA4 keys, but all application buckets are per Function instance and are not globally authoritative. Production abuse protection depends on operator-enabled WAF rules. JA4 is shared by many legitimate clients and must not be treated as identity by itself. Another reverse proxy would require an explicit trusted-proxy design.
5. **Inventory capacity and cost scale with the complete object.** The application limits the serialized inventory object to 32 MiB and the schema to 500 vehicles, but those are validation ceilings rather than performance targets. Every authoritative read or mutation transfers the full JSON state, and mutations rewrite it. Monitor latency, transfer, object size, write conflicts, and cost; move to a transactional database before catalog size or write frequency makes this design unsuitable.
6. **Automatic migration is intentionally one-time and absence-triggered.** If `inventory/state-v1.json` is missing, the application seeds it from legacy `inventory_state_v1` when `INVENTORY_GLOBAL_CONFIG` is configured, otherwise from an empty schema. A wrong environment connection or premature removal of the legacy variable can therefore initialize an empty object. Once the Blob exists it wins, even if the legacy record differs. Operators must verify revisions and counts before removing the legacy connection and must treat deletion of the authoritative object as a data-loss incident, not a reset.
7. **Audit is append-only by convention, not tamper-proof against a stolen Blob token.** A credential with delete authority can remove objects. Export or replicate audit evidence if regulatory immutability is required.
8. **Ceremony and state failure behavior.** A WebAuthn challenge marker is consumed before cryptographic verification, so a failed verification or failed downstream write burns that challenge and requires fresh options. Bootstrap and recovery do not burn a separate permanent credential marker before the authoritative CAS. If a write response is ambiguous, the next uncached `auth_state` read and lifecycle state decide whether the operation committed; operators must not force a reset by editing the row by hand. Losing the one-time recovery-code response after a committed activation requires passkey login followed by code rotation.
9. **Authenticator counters are advisory.** Synced passkeys may always return zero and are allowed. A nonzero counter regression is rejected during verification, and the auth store refuses to move a persisted counter backwards, but zero-counter credentials provide limited cloned-authenticator detection.
10. **Blob retention needs an operator policy.** The deterministic auth and inventory state objects must not be deleted. Security consume markers and audit snapshots have no automatic application TTL, and abandoned private staging uploads or detached public photographs can accumulate. Define retention windows, preserve required audit evidence, and periodically inventory/delete only verified expired markers and unreferenced objects. A validated public Blob exists before the later vehicle update attaches its URL, so an interrupted editor flow can create an orphan.
11. **Browser compromise remains powerful.** XSS, a malicious extension, or a compromised device can read an unlocked draft and act through an authenticated session. CSP and short sessions reduce but cannot remove this risk. JavaScript keys cannot be reliably zeroized.
12. **Recovery has no backdoor.** Starting recovery changes the authoritative lifecycle to `RECOVERY` and invalidates existing sessions. An expired browser proof may be resumed only with the password and a still-current recovery code. Loss of every passkey and every recovery code is intentionally unrecoverable through the application. Manual state intervention is highly sensitive and must use a verified backup/change process.
13. **Platform and supply chain.** Vercel, GitHub, npm dependencies, DNS, and operator accounts remain trusted. Require MFA/passkeys, branch protection, dependency review, and least-privilege team membership.
14. **Test-only enrollment exception.** Automated browser tests use an explicit loopback-only, non-Vercel enrollment flag. Production and Preview run with `NODE_ENV=production`, and the setup gate still requires `VERCEL_ENV=production` plus an HTTPS configured origin. The test flag must never be set in a deployed environment.

## Out of scope

Payment processing, financing applications, customer accounts, rich-text HTML, email/SMS recovery, destructive vehicle deletion, and a cryptographically external audit ledger are not implemented.
