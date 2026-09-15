# Security Console authentication investigation

Status: the earlier implementation was pushed as `b08a4ba`; the historical
deployment evidence below applies to that revision. The passkey follow-up fix
below is locally verified. Authenticated Production runtime and
Redis-state verification remain outstanding.

## September 15: resolve unfinished passkey enrollment changes

The unfinished follow-up rejected established credentials without `schema: 2`,
offered password-only first-passkey enrollment, replaced the versioned store,
deleted legacy credentials, and upgraded registration directly to MFA.

The corrected implementation removes those bootstrap routes, helpers, and UI.
Existing credentials remain eligible by credential epoch, including credentials
without a schema marker and password-verified legacy migrations. Malformed
stores fail closed; missing credentials leave access locked. Only a verified
assertion can upgrade a password session. Managed registration still requires
MFA, appends to established credentials, preserves supported transport hints,
and cannot replace an empty or malformed store. Unrelated diagnostic notes and
UI cleanup were preserved.

Local validation on Node 22.23.2:

- `npm run check`: lint, typecheck, 212 unit tests, production build passed.
- `npm run test:security-console`: 15 integration tests passed; the extended
  `python scripts/verify-security-session-lua.py` passed 33 assertions.
- Separate `security-console` package: typecheck and 7 tests passed.
- `npm run test:e2e -- e2e/security-console.spec.ts`: 3 browser/API checks passed.
- Regression coverage includes real signed assertions from migrated keys,
  rejected bootstrap requests with established/empty/missing/malformed stores,
  preservation of legacy records, managed enrollment, and challenge replay.

Python `lupa==2.8` was installed in an isolated ignored `.data` virtual
environment for these checks. No production credentials or Redis records were
used or changed. Physical-authenticator and hosted-runtime verification were
not performed. These results describe local verification before publication;
they do not establish the follow-up's deployment status.

## Follow-up: historical root causes and deployment evidence

The follow-up investigation traced earlier deployed implementations, rather than
assuming the latest Redis-pair fix explained the reported incident.

### Confirmed historical source defects

1. **Password and passkey were originally alternatives.** At `e0b3b97`,
   `src/app/api/security-console-auth/route.ts` called `createSecuritySession()`
   directly after successful password verification. Its session record had no
   authentication factor, and `isSecurityAuthenticated()` accepted that session.
   The page explicitly offered password **or** passkey. `e2268bf` subsequently
   introduced a password-level session. This is a real historical password-only
   path, not a claim that the current implementation permits it.
2. **Credential migration was incomplete.** At `70d309e`, password verification
   could migrate the legacy password/epoch, but passkey lookup read only
   `speedzone:security-console:passkeys:v1`. Existing keys under
   `speedzone:security-console:passkeys` were not migrated. Therefore valid legacy
   passkeys in the same database could appear absent without being deleted.
3. **Missing keys opened enrollment instead of locking access.** In that revision,
   login routed to `/passkeys` when `hasCurrentPasskey()` was false. The management
   page allowed password sessions; initial registration allowed them when no
   current key existed; registration then called `upgradeSecuritySession()`.
   That upgraded to MFA without an assertion from an established credential.
   The old validator accepted MFA records without assertion timestamps.
4. **Redis selection also changed between implementations.** The early
   `security-store.ts` preferred `SECURITY_KV_*`, while the replacement preferred
   `ADMIN_SECURITY_KV_*`. If both were configured to different databases, the
   replacement would read a different store. The independent URL/token fallback
   also permitted mixed pairs. Actual Production variable presence and instance
   identity remain unknown; this is a conditional cause, not an observed switch.

An isolated execution of the actual Lua from Git history confirmed:

| Revision | Password session accepted for MFA | MFA record without assertion timestamp accepted |
| --- | --- | --- |
| `70d309e` | No | Yes |
| `55eb328` | No | No |
| `b08a4ba` | No | No |

All records were synthetic and in memory. No production state was accessed.

### Newly verified production history

Public GitHub deployment objects and their status endpoints identify these
successful **Production** deployments (Eastern daylight time):

| Revision | Successful deployment | GitHub deployment ID |
| --- | --- | --- |
| `e0b3b97` | September 14, 2026, 1:23:43 AM | `6431000094` |
| `70d309e` | September 14, 2026, 10:48:29 AM | `6439661793` |
| `55eb328` | September 14, 2026, 4:28:39 PM | `6445813342` |
| `b08a4ba` | September 15, 2026, 10:42:12 AM | `6461436796` |

Sources: `https://api.github.com/repos/PaulinoTech1/Speedzone/deployments?environment=Production&per_page=30`
and each deployment's `/statuses` endpoint. The latest deployment URL is
`https://speedzone-7p8xtysh4-boss-projects-5a103493.vercel.app`.

The current custom-domain login returns the established-passkey instruction;
its referenced client bundle routes password success to `/login/passkey` and
contains `authentication-options`. No public deployment ID appeared in that
HTML. These observations support the newer flow but do not independently prove
the custom domain's exact backend SHA, runtime variables, or session contents.

### Incident attribution remains conditional

The historical defects above were deployed. They explain how password-only
access and apparently missing established keys could occur. They do not establish
which state the operator encountered or reproduce a current password-only bypass.
The time of the last reproduction and the exact destination after password entry
are still needed, along with safe Production Redis/session diagnostics.

A present versioned passkey store, including `[]`, is authoritative even today.
If earlier enrollment created it, migration deliberately will not overwrite it
with legacy keys. Do not delete it, reset epochs, or auto-enroll to investigate.

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
changed by this investigation. The patch was subsequently committed/pushed at
the user's request and Vercel reported the successful deployment above.

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
Authenticated verification remains outstanding despite the successful Git push
and provider-reported Production deployment.
