# Threat model

## Scope and assets

Protected assets are administrator credentials, passkey metadata, recovery-code hashes, session authority, unpublished inventory, vehicle mutations, storage/API credentials, and the optional local draft key. Published inventory and public photos are intentionally public.

Trust boundaries are the public browser, admin browser, Vercel edge/WAF, Next.js Node Functions, the `SEcure_Auth` Neon database, the private Sanity dataset holding inventory and photographs, and the operator's Vercel/Neon/Sanity/GitHub accounts.

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
| Challenge replay | Encrypted/bound ceremony cookie plus an atomic, single-use `auth_consume_markers` row (composite primary key) burned before verification |
| Cross-site mutation | SameSite-Strict host cookies, exact Origin allowlist, sealed session-bound CSRF token |
| Session theft/persistence | HttpOnly/Secure cookies, 15-minute idle and eight-hour absolute limits, rotation, individual revocation, global epoch |
| Unauthorized passkey changes | Complete session plus password proof plus fresh assertion from an existing passkey; old passkey-only proof cookies are invalid; final passkey cannot be deleted |
| Lost authenticators | Ten 130-bit single-use offline codes; password plus code plus new user-verified passkey; all old keys/epochs replaced |
| Stored XSS | Plain text fields, Zod bounds, React escaping, safe JSON-LD encoding, nonce CSP |
| Photo polyglots/metadata | Canvas re-encode client-side, then a fully independent server-side WebP decode and fresh re-encode with byte/dimension limits before the verified buffer (never the caller's bytes) reaches storage |
| Inventory tampering | Authorization on every application API; Sanity project roles for Studio; application revision gates and atomic lock documents; Studio validation and controlled Publish action |
| Distributed request flood | Proposed Vercel WAF IP+JA4 limits plus per-instance setup IP/JA4 and other client/subject limits |
| Local draft disclosure | Separate never-transmitted passphrase, Argon2id, AES-GCM, IndexedDB, AAD, unique nonces, memory-only key |

## Remaining risks and explicit limitations

1. **Inventory uniqueness is an application-level convention, not a database constraint.** The application creates `vehicleLock` documents transactionally and now also checks actual vehicle documents, while Studio supplies asynchronous uniqueness validation. Studio validation and its version-stamping Publish action are client-side workflow controls: a direct API client or simultaneous Studio/application race can bypass the shared-lock convention. Limit Studio membership, prefer one editing surface at a time for identity fields, and investigate any generic conflict before retrying. Live cross-editor behavior remains a deployment verification item.
2. **Authentication availability now depends on `SEcure_Auth`.** Authentication state is read uncached from the single `auth_state` row and written with a `revision` compare-and-swap, so bootstrap activation is one revision-checked change and competing registrations cannot both activate. There is no mirror and no read replica: if the database is unreachable, or its schema has not been applied, every administrator request fails closed rather than degrading. That is the intended trade, but it makes Neon availability, connection limits, and point-in-time restore operational requirements. Live compare-and-swap and failure behavior remains a deployment verification item, not a guarantee established only by unit mocks.
3. **Runtime credential blast radius.** `AUTH_DATABASE_URL` carries a role password that can read and rewrite the whole authentication record, so it belongs only in Production as a Sensitive Environment Variable, on a role scoped to `SEcure_Auth` with no rights over other databases and no DDL beyond the migration role. `SANITY_API_TOKEN` is scoped to the Editor role (content and asset read/write, no project administration) but still permits reading and rewriting every vehicle document and uploading arbitrary assets; use separate, narrowly scoped Production/Preview tokens and datasets, and rotate after suspected exposure.
4. **Rate-limit layers differ.** The setup Function enforces three attempts per rolling 30 minutes on pseudonymized Vercel IP and JA4 keys, but all application buckets are per Function instance and are not globally authoritative. Production abuse protection depends on operator-enabled WAF rules. JA4 is shared by many legitimate clients and must not be treated as identity by itself. Another reverse proxy would require an explicit trusted-proxy design.
5. **No application-enforced inventory size ceiling.** Each vehicle is an independent document, so the previous whole-object 32 MiB/500-vehicle validation ceiling no longer applies, and list reads are unbounded GROQ queries rather than a single-object transfer. This removes a scaling limit but also removes a safety backstop: monitor dataset size, query latency, and API cost as inventory grows, since nothing in the application caps it.
6. **No audit trail beyond Sanity's own document history.** There is no application-level append-only record of who changed what and when (the previous Blob-based audit snapshot was removed as part of this migration, since nothing ever read it back). Sanity's per-document `_rev` history is the only change record, is not exposed anywhere in this application's UI, and depends entirely on the Sanity project retaining it. Export or replicate change evidence if regulatory audit requirements apply.
7. **An interrupted photo upload can leave an orphaned Sanity asset.** Uploading is now a single server call, but attaching the resulting asset to a vehicle is still a separate, subsequent save. If the browser or network fails between the two, the asset exists in Sanity but is referenced by no vehicle. There is no reconciliation tool for this in the current version; an operator must find and remove unreferenced assets directly in Sanity.
8. **Ceremony and state failure behavior.** A WebAuthn challenge marker is consumed before cryptographic verification, so a failed verification or failed downstream write burns that challenge and requires fresh options. Bootstrap and recovery do not burn a separate permanent credential marker before the authoritative CAS. If a write response is ambiguous, the next uncached `auth_state` read and lifecycle state decide whether the operation committed; operators must not force a reset by editing the row by hand. Losing the one-time recovery-code response after a committed activation requires passkey login followed by code rotation.
9. **Authenticator counters are advisory.** Synced passkeys may always return zero and are allowed. A nonzero counter regression is rejected during verification, and the auth store refuses to move a persisted counter backwards, but zero-counter credentials provide limited cloned-authenticator detection.
10. **Retention needs an operator policy.** The `auth_state` row must never be deleted. `auth_consume_markers` rows have no automatic TTL and are only swept as a side effect of `npm run migrate:auth-db`; schedule that as periodic maintenance, not a one-time step. Unreferenced Sanity assets (see risk 7) similarly need a periodic manual review, since nothing in the application deletes them automatically.
11. **Browser compromise remains powerful.** XSS, a malicious extension, or a compromised device can read an unlocked draft and act through an authenticated session. CSP and short sessions reduce but cannot remove this risk. JavaScript keys cannot be reliably zeroized.
12. **Recovery has no backdoor.** Starting recovery changes the authoritative lifecycle to `RECOVERY` and invalidates existing sessions. An expired browser proof may be resumed only with the password and a still-current recovery code. Loss of every passkey and every recovery code is intentionally unrecoverable through the application. Manual state intervention is highly sensitive and must use a verified backup/change process.
13. **Platform and supply chain.** Vercel, GitHub, npm dependencies, DNS, and operator accounts remain trusted. Require MFA/passkeys, branch protection, dependency review, and least-privilege team membership.
14. **Test-only enrollment exception.** Automated browser tests use an explicit loopback-only, non-Vercel enrollment flag. Production and Preview run with `NODE_ENV=production`, and the setup gate still requires `VERCEL_ENV=production` plus an HTTPS configured origin. The test flag must never be set in a deployed environment.

## Out of scope

Payment processing, financing applications, customer accounts, rich-text HTML, email/SMS recovery, destructive vehicle deletion, and a cryptographically external audit ledger are not implemented.
