# Security Console authentication investigation

Status: local implementation and verification complete; production verification
and deployment blocked on authenticated Vercel access.

## Evidence collected before editing

- Local HEAD: `cd2404f22c8c29e19d791500daec9121952f966e`, containing
  `55eb328ae5323444fbb1e5a623c46cf02d7993ec`.
- `src/app/Security_Console/` reexports the shared `security-console/app/`
  implementation. Root `next.config.ts` sets the mounted base path. Root proxy
  adds security headers; authorization occurs in the shared pages and handlers.
- Password login creates only a password session. Protected pages use
  `requireMfa()`. Session Lua requires assertion evidence for MFA. No direct
  password-only dashboard bypass was found in this revision.
- The Redis helper independently selected URL and token across two namespaces,
  allowing a partial dedicated configuration to form a mixed pair.
- Assertion options returned HTTP 200 even when no established passkey existed.
  The password-verified page did not load or display established-passkey counts.
- Password migration could overwrite an existing versioned epoch when its hash
  was missing, and did not atomically compare the legacy epoch during migration.

These are source defects, not proof of the reported production bypass. Wrong
Redis instance, environment mismatch, deployed SHA, epoch mismatch, malformed
records, and migration state require authenticated runtime evidence.

## Candidate changes

- Select coherent dedicated writable REST credentials. Partial pairs fail
  closed; legacy fallback requires the dedicated pair to be absent.
- Preserve password -> established assertion -> rotated MFA architecture.
- Return failure statuses for missing passkeys and generic storage exceptions.
- Show count only after password authorization; keep passkey management under MFA.
- Add read-only, allowlisted health diagnostics and non-secret failure logs.
- Refuse partial versioned password state and compare legacy epoch atomically.
  Existing passkey migration and its authoritative versioned-store behavior remain.

No production records, passkeys, epochs, secrets, or environment variables were
changed. No commit or deployment was performed.

## Validation

- Focused Vitest: 49 tests passed across 11 files.
- Full root suite: `node node_modules/vitest/vitest.mjs run --maxWorkers=1`:
  201 tests passed across 31 files. Default parallel `npm test` twice returned
  200 passed / 1 failed on the existing YAML merge-budget elapsed-time assertion
  (23.16 ms and 22.46 ms versus 20 ms). That test passes alone; no assertion or
  production dependency patch was weakened.
- Dedicated mounted-handler integration: 11 tests passed. Uses real Argon2,
  cryptographically signed synthetic P-256 WebAuthn assertions, and production
  Lua executed by Python/lupa. Redis primitives are an in-memory test adapter;
  this does not validate Upstash networking, TTL scheduling, or cloud concurrency.
- Existing Lua harness: 26 authorization/migration assertions passed.
- Root and standalone console lint and TypeScript checks passed.
- Standalone console suite: 7 tests passed across 4 files.
- `npm run build`: passed; mounted console pages and APIs appear in the build.
- `node node_modules/@playwright/test/cli.js test e2e/security-console.spec.ts`:
  3 passed. Windows server cleanup required elevated execution; the final run
  exited successfully in 3.5 seconds. Browser checks cover anonymous/admin-cookie
  denial and login rendering; the signed assertion flow is verified separately
  by the integration suite, not with a production authenticator.
- Independent read-only patch review found no concrete surviving bypass or
  regression. `git diff --check` passed.
- Local runtime is Node 24.13.1; the repository and CI target Node 22.x.

Reproduce the dedicated integration checks with Python and `lupa==2.8` available
(the test dependency is installed outside this repository in the local Windows
temporary directory). CI installs the pinned dependency and runs the same command:

```powershell
npm.cmd run test:security-console
```

## Production evidence and required follow-up

Read-only unauthenticated requests returned login HTTP 200, redirects to login
for dashboard/passkeys/integrity/reports, and HTTP 401 for events/passkeys APIs.
The live login mentions established passkeys. This does not verify password-only
sessions or the deployed commit.

Vercel connector returned no accessible teams; CLI was logged out, and browser
discovery returned no available browser. An authorized
operator must verify the project deploys root `main`, its production SHA includes
the reviewed patch and hardening commit, and the dedicated writable REST pair
exists in **Production** and points to the existing credential database. Check
deployment time against environment changes and redeploy when necessary.

Inspect only safe record presence/counts and epoch values. Preserve authoritative
versioned stores, including empty arrays. Do not reset epochs or automatically
enroll replacement keys. Preserve the original RP ID and expected origin for
established passkeys. Verify the complete password/passkey/browser flow in
Production after access and deployment are available.

## Files changed

- `security-console/lib/redis.ts`: coherent writable configuration.
- `security-console/lib/password.ts`: partial-state and migration epoch checks.
- `security-console/lib/passkeys.ts`: established count and failure statuses.
- `security-console/lib/rate-limit.ts`: unavailable storage fails closed.
- `security-console/lib/auth-health.ts`: new safe, read-only diagnostics.
- `security-console/lib/dashboard.ts`: coherent configuration status.
- `security-console/app/api/auth/login/route.ts` and
  `security-console/app/api/auth/passkeys/route.ts`: generic error handling,
  failure logs, and fail-closed response statuses.
- `security-console/app/login/passkey/page.tsx` and
  `security-console/app/page.tsx`: established-key count and protected health view.
- Focused tests: credential migration, dashboard access, passkey gate, Redis
  configuration, authentication health, and passkey page rendering.
- `tests/security-console-flow.integration.ts`,
  `tests/security-console.integration.config.mts`, and
  `tests/helpers/security-lua.py`: mounted-handler, real signature/Lua checks.
- `package.json` and `.github/workflows/ci.yml`: repeatable integration command
  and CI execution. Dependency versions and lockfile are unchanged.
- This report.

## Remaining risks

The source defects do not establish the production incident's root cause.
Production password-only denial, actual credential database contents, deployed
SHA/root/branch, environment scope, provider TTL behavior, and the operator's
existing authenticator remain unverified. Existing dependency-audit findings
and the unrelated parallel YAML timing failure are outside this patch.
No new production deployment or Git push has been made.
