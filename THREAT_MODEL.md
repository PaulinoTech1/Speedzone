# Threat model

## Scope and assets

Protected assets are administrator credentials, passkey metadata, recovery-code hashes, session authority, unpublished inventory, vehicle mutations, private staging photographs, audit history, storage/API credentials, and the optional local draft key. Published inventory and public photos are intentionally public.

Trust boundaries are the public browser, admin browser, Vercel edge/WAF, Next.js Node Functions, Global Config, private Blob, public-photo Blob, and the operator's Vercel/GitHub accounts.

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
| Inventory tampering | Authorization on every API, validation, optimistic versions, uniqueness index keys, private before-change audit snapshots |
| Distributed request flood | Proposed Vercel WAF IP+JA4 limits plus per-instance setup IP/JA4 and other client/subject limits |
| Local draft disclosure | Separate never-transmitted passphrase, Argon2id, AES-GCM, IndexedDB, AAD, unique nonces, memory-only key |

## Remaining risks and explicit limitations

1. **Inventory Global Config is not a transactional database.** It has no documented compare-and-swap primitive. Same-instance locks and revision checks do not prevent lost inventory updates across concurrent Functions. Batch writes and `create` index keys make stock/VIN/slug uniqueness best-effort, not relationally guaranteed.
2. **The auth Global Config value is only a mirror.** Authentication state is read uncached from a deterministic private Blob and conditionally written with its ETag. Bootstrap activation is one revision-checked record change, so competing registrations cannot both activate. The Global Config mirror can lag, or briefly receive an older revision while concurrent writers repair it, so it is never used for authentication or authorization decisions. A mirror write failure is logged after the authoritative commit and requires operational reconciliation. Live Vercel ETag and failure behavior remains a deployment verification item, not a guarantee established only by unit mocks.
3. **Runtime management credential blast radius.** Global Config writes require `VERCEL_API_TOKEN`; this is broader than a store-only write secret. A Function compromise can expose more Vercel control-plane authority than ideal. Use the narrowest team/account scope available, separate environments, monitoring, and rotation.
4. **Rate-limit layers differ.** The setup Function enforces three attempts per rolling 30 minutes on pseudonymized Vercel IP and JA4 keys, but all application buckets are per Function instance and are not globally authoritative. Production abuse protection depends on operator-enabled WAF rules. JA4 is shared by many legitimate clients and must not be treated as identity by itself. Another reverse proxy would require an explicit trusted-proxy design.
5. **Write throughput and capacity are bounded.** Global Config Pro documents 100 writes/hour and 1 MB per store, while the schema caps inventory at 500 vehicles. The application mutation limiter is an abuse ceiling, not a promise that storage can sustain 120 writes/minute.
6. **Audit is append-only by convention, not tamper-proof against a stolen Blob token.** A credential with delete authority can remove objects. Export or replicate audit evidence if regulatory immutability is required.
7. **Ceremony and state failure behavior.** A WebAuthn challenge marker is consumed before cryptographic verification, so a failed verification or failed downstream write burns that challenge and requires fresh options. Bootstrap and recovery do not burn a separate permanent credential marker before the authoritative CAS. If a write response is ambiguous, the next uncached private-Blob read and lifecycle state decide whether the operation committed; operators must not force a reset from a stale mirror. Losing the one-time recovery-code response after a committed activation requires passkey login followed by code rotation.
8. **Authenticator counters are advisory.** Synced passkeys may always return zero and are allowed. A nonzero counter regression is rejected during verification, and the auth store refuses to move a persisted counter backwards, but zero-counter credentials provide limited cloned-authenticator detection.
9. **Blob retention needs an operator policy.** Security consume markers and audit snapshots have no automatic application TTL, and abandoned private staging uploads or detached public photographs can accumulate. Define retention windows, preserve required audit evidence, and periodically inventory/delete only verified expired markers and unreferenced objects. A validated public Blob exists before the later vehicle update attaches its URL, so an interrupted editor flow can create an orphan.
10. **Browser compromise remains powerful.** XSS, a malicious extension, or a compromised device can read an unlocked draft and act through an authenticated session. CSP and short sessions reduce but cannot remove this risk. JavaScript keys cannot be reliably zeroized.
11. **Recovery has no backdoor.** Starting recovery changes the authoritative lifecycle to `RECOVERY` and invalidates existing sessions. An expired browser proof may be resumed only with the password and a still-current recovery code. Loss of every passkey and every recovery code is intentionally unrecoverable through the application. Manual state intervention is highly sensitive and must use a verified backup/change process.
12. **Platform and supply chain.** Vercel, GitHub, npm dependencies, DNS, and operator accounts remain trusted. Require MFA/passkeys, branch protection, dependency review, and least-privilege team membership.
13. **Test-only enrollment exception.** Automated browser tests use an explicit loopback-only, non-Vercel enrollment flag. Production and Preview run with `NODE_ENV=production`, and the setup gate still requires `VERCEL_ENV=production` plus an HTTPS configured origin. The test flag must never be set in a deployed environment.

## Out of scope

Payment processing, financing applications, customer accounts, rich-text HTML, email/SMS recovery, destructive vehicle deletion, and a cryptographically external audit ledger are not implemented.
