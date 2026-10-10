# Speedzone security remediation change register

Recorded: **2026-10-10**. Repository: [PaulinoTech1/Speedzone](https://github.com/PaulinoTech1/Speedzone). Review and release work: [PR #115](https://github.com/PaulinoTech1/Speedzone/pull/115), branch `fix/security-assessment-2026-10-10`.

## Executive status

The assessment identified three High and six Medium findings. Remediation code, regression tests, and a controlled rollout procedure are committed for review. Nine Vercel environment records were restricted to Production, and five missing Production settings were created. Automated validation passed for implementation commit `4078ff053643eaf8acdbdcbe048b0c580a90491d`.

**The remediation has not been merged or deployed to Production, and Production inventory has not been migrated.** Production was rechecked when preparing this register and still runs base commit `1d920e9552760ad0c8faaf8eaaf79f02a47736eb`, deployment `dpl_EmKGDk1ohUgRAgQWbVUuULbki8uV` (READY). Environment edits apply to future deployments; they do not remove credentials from existing deployment snapshots. This document-only update does not change application behavior.

Production closure requires the verified owner recovery mailbox, provider credential rotation and historical deployment restrictions, a reviewed inventory cutover, deployment, and operator acceptance testing. The steps and rollback constraints are in [security-remediation-rollout.md](security-remediation-rollout.md).

## Finding and remediation register

| ID / assessed severity | Implemented change | Current closure status |
| --- | --- | --- |
| F1 / High: setup-session authorization | Password setup sessions last five minutes and authorize initial enrollment only. Enrollment atomically consumes the session and rotates its generation. Inventory, customer requests, and diagnostics require a passkey session. Initial session exchange is pinned to the committed generation. | Code and regression tests complete; deployment and live retest pending. |
| F2 / High: passkey replacement authorization | Root admin and standalone console require a fresh, user-verified assertion from an existing key before adding/removing a key. Action grants are single-use and bind the session, generation, epoch, operation, and target. Lua rechecks authorization at commit. Removing a key revokes other sessions and old grants; the current session keeps its original lifetime. The last key cannot be removed. | Code and regression tests complete; genuine-authenticator operator retest pending. |
| F3 / High, conditional: shared Production credentials | Nine shared Vercel records now target Production only. No provider credential values were rotated. Preview requires separately provisioned resources for authenticated workflows. | Scope changes complete; rotation and restrictions on historical deployments remain required. |
| F4 / Medium, conditional: cross-origin mutations | Inventory writes, upload authorization, cleanup, and passkey mutations require the exact configured/request origin and JSON. Fetch Metadata must be absent or same-origin. Streaming body limits and read deadlines apply. | Code and rejection tests complete; deployment and sibling-origin live retest pending. |
| F5 / Medium: stale inventory overwrite | Redis v2 holds both the authoritative document and revision. Lua compare-and-set prevents stale edits. Immutable Blob history is written before commit. Legacy Blob data is read-only fallback; no automatic CDN import is allowed. | Code and migration tooling complete; reviewed Production migration pending. |
| F6 / Medium: photo cleanup races | Upload leases, non-overwriting paths, minimum photo age, atomic reference/revision checks, and persistent deletion markers coordinate cleanup with attachments. Physical deletion after listing edits is deferred to cleanup. Photo URL identity is normalized. | Code and race regression tests complete; cutover and cleanup dry-run pending. |
| F7 / Medium: rate-limit failure mode | Admin login and test-drive limiters have a two-second deadline. SDK timeout results and exceptions fail closed with unavailable responses; they do not create sessions or accept submissions. | Code and failure tests complete; live provider-failure acceptance pending. |
| F8 / Medium: dependencies | Root and console use Next 16.3.8 and matching eslint-config-next; overrides require sharp >=0.35.5 and source-map-js >=1.2.2. Both lockfiles resolve the patched versions. Node manifests and CI target 24.x. | Builds and production dependency audits passed; Production still runs the previous build. |
| F9 / Medium, operational: missing configuration | Five Production settings were created. Recovery validates required configuration and returns 503 if unavailable; links use the canonical admin origin. Production prebuild checks required configuration. Passkey-only diagnostics expose readiness booleans without secret values. | Partial configuration complete; ADMIN_RECOVERY_EMAIL absent, deployment and recovery/report/delivery acceptance pending. |

Severity describes application impact and prerequisites from the assessment. No anonymous takeover or Critical application exploit was demonstrated. F3/F4 are conditional findings; package advisory ratings are not evidence of a reachable application exploit.

## Vercel settings actually changed

Project: `speedzone` (`prj_BMnPwZJliudeFQryk19zYtJd2V0G`). This register records names, scopes, and purposes only. Secret values and encrypted representations are intentionally excluded.

| Setting record | Before | After | Value change / purpose |
| --- | --- | --- | --- |
| ADMIN_SECURITY_KV_REST_API_URL | Production + Preview | Production only | Existing value retained; console datastore isolation. |
| ADMIN_SECURITY_KV_REST_API_TOKEN | Production + Preview | Production only | Existing value retained; writable console datastore credential. |
| ADMIN_SECURITY_KV_REST_API_READ_ONLY_TOKEN | Production + Preview | Production only | Existing value retained; console datastore read credential. |
| ADMIN_SECURITY_KV_URL | Production + Preview | Production only | Existing value retained; console datastore connection configuration. |
| ADMIN_SECURITY_REDIS_URL | Production + Preview | Production only | Existing value retained; console Redis connection configuration. |
| SPEEDZONE_ADMIN_PASSWORD | Production + Preview | Production only | Existing value retained; bootstrap password scope, not a stored password reset. |
| SECURITY_LOG_INGEST_TOKEN | Production + Preview | Production only | Existing value retained; logging ingestion authorization. |
| SECURITY_LOG_INGEST_URL | Production + Preview | Production only | Existing value retained; logging ingestion endpoint. |
| TURNSTILE_SECRET_KEY | Production + Preview | Production only | Existing value retained; server-side challenge verification secret. |
| BUG_REPORT_ENCRYPTION_KEY | Absent | New, Production only | Independent 32 random bytes, base64url; server-side report encryption. |
| BUG_REPORT_RATE_LIMIT_SECRET | Absent | New, Production only | Independent 32 random bytes, base64url; report rate-limit secret. |
| SECURITY_CONSOLE_TEST_SECRET (Production record) | Absent in Production | New, Production only | Independent 32 random bytes, base64url; delivery-test authorization. |
| BUG_REPORT_ORIGIN | Absent | New, Production only | `https://www.speedzonems.com`; canonical reporting origin. |
| SECURITY_TEST_TARGET_URL | Absent | New, Production only | `https://www.speedzonems.com/api/internal/security-log-test`; delivery-test endpoint. |

Separate Development records for SPEEDZONE_ADMIN_PASSWORD and TURNSTILE_SECRET_KEY were retained. The existing Preview-only SECURITY_CONSOLE_TEST_SECRET record was retained with a different value from the new Production record. Public identifiers and site keys were not generally rescaled or rotated.

**Still absent:** ADMIN_RECOVERY_EMAIL. An exact verified client-owner mailbox must be supplied; the GitHub repository owner's email must not be assumed to be the client's recovery address. Existing Resend recovery API/domain settings remain in use by the implementation. No mailbox was guessed and no email was sent as part of this remediation.

No provider credentials were revoked or rotated, and old deployment snapshots were not retired. DNS, Cloudflare, firewall rules, TLS configuration, and the existing Vercel deployment-protection setting were not changed by this work.

## Application configuration and behavior changes

These are committed code defaults and release requirements, separate from the Vercel settings already edited above.

| Control | New behavior or retained bound | Operational consequence |
| --- | --- | --- |
| Production admin cookie | `__Host-speedzone_admin`; Secure, HttpOnly, SameSite Strict, Path `/`, no Domain | Browsers must authenticate again after deployment. |
| Sessions | Setup 5 minutes; passkey sessions retain 8-hour absolute and 30-minute idle lifetimes | Setup is not sufficient for private data access. |
| Sensitive-action authorization | Five-minute one-use grants; registration freshness 120 seconds; live session/generation/epoch checks at commit | Established-key verification is required for managed key changes. |
| Mutation parsing | Default JSON limit 64 KiB, streaming read deadline 5 seconds; cleanup confirmation limit 1 KiB | Unsupported types, excessive bodies, timeouts, and malformed JSON return 415/413/408/400. |
| Inventory v2 | Redis key `speedzone:inventory:catalog:v2`; `{version:2,revision,vehicles}`; maximum 512 KiB, 500 listings, 24 photos/listing | Stale updates return 409; unavailable/uninitialized write state returns 503. |
| Inventory backups | Immutable `inventory/history/<revision>.json` written before authoritative commit | History is a recovery aid; Redis durability and access control remain necessary. |
| Photo handling | 24-hour lease; upload authorization validity at most 1 hour; cleanup candidates at least 24 hours old; at most 100 claims/request | Cleanup failures leave markers for safe retry. Claimed/deleted paths cannot be reused. |
| Upload restrictions | JPEG/PNG/WebP, maximum 8 MiB per photo retained; paths reserved with NX, no overwrite | Replacements use a new path. |
| Limiter unavailability | Two-second deadline, fail closed, 503 at affected routes; timeout/exception retry guidance 30 seconds | Provider outages temporarily disable affected authentication/submissions. |
| Production build gate | `scripts/check-security-config.mjs`, invoked by prebuild for VERCEL_ENV=production | Missing/invalid required settings block a Production build; local/Preview do not borrow Production secrets. |
| Readiness | `/api/admin/config-health`, passkey-only boolean status for recovery/reporting/delivery/inventory | Admin Diagnostics shows configuration readiness without disclosing secret values. |
| Origin example | Root `.env.example` WEBAUTHN_ORIGIN uses the inventory admin origin; RP ID remains speedzonems.com | Operators must confirm target origins during rollout. |

Shared authorization and parsing helpers are under `security-console/shared/credential-grants.ts` and `security-console/shared/mutation-request.ts`. The standalone console remains independently buildable. `scripts/migrate-inventory.mjs` requires a reviewed local export, supports a counts/hash dry run, pins `--apply` to `--sha256`, initializes with NX, refuses existing v2 state, and requires `--allow-empty` for an empty catalog.

## Validation record

The following results apply to implementation commit `4078ff053643eaf8acdbdcbe048b0c580a90491d`, before this documentation-only commit.

| Validation | Result |
| --- | --- |
| Root unit suite | 268 tests across 43 files passed. |
| WebAuthn/Lua integration | 66 tests across 2 files passed, plus 39 Lua authorization assertions. Real WebAuthn cryptographic verification and Lua execution through the test Redis emulator were exercised. |
| Browser suite | 13 Playwright tests passed locally; GitHub CI also passed with its pinned Chromium installation. |
| Root lint, TypeScript, Production build | Passed. |
| Standalone console | 7 tests across 4 files and Production build passed using isolated dependencies. |
| Production dependency audits | Root and console `npm audit --omit=dev`: zero reported vulnerabilities at validation time. |
| Migration safeguards | Synthetic dry run and mismatched-hash refusal passed; no Production data was written. |
| Source secret scan | No secret literals found in tracked source/new code by the checks run. |
| GitHub CI | [Validate application, run 38031529734](https://github.com/PaulinoTech1/Speedzone/actions/runs/38031529734) passed, including root and standalone validation. |
| External checks | Snyk check and Vercel Preview succeeded for the implementation commit. |

CI now validates root lint/typecheck/unit/security integration/audit/build/browser checks, then independently installs, audits, builds, and tests the console. Test-only Host routing runs in `e2e/server.mjs`; no Production host bypass was added. Browser fixtures now use the v2 `{vehicles,revision}` API and passkey-only privacy behavior. A flaky YAML timing assertion was replaced with deterministic traversal/source bounds and the worker deadline.

Automated tests used synthetic accounts/data and do not replace the remaining genuine-authenticator, real email, Production data, and provider acceptance checks. A dependency audit result is point-in-time, not a guarantee that no future advisories exist.

## Production handoff and remaining actions

| Action | Responsible role | Completion evidence |
| --- | --- | --- |
| Supply exact ADMIN_RECOVERY_EMAIL | Client owner and deployment operator | Verified owner mailbox configured; genuine recovery received and exercised. |
| Rotate previously shared credentials and constrain historical deployments | Provider/deployment administrator | Provider revocation/rotation confirmed, Production settings updated, old writable deployments restricted/retired. |
| Provision independent Preview resources if authenticated previews are required | Deployment administrator | Preview cannot read/write Production state; separate credentials and origins verified. |
| Freeze legacy writers; retain and review current inventory export | Client inventory operator and deployment operator | Listing/photo counts, IDs, recent edits, retained backup, and reviewed SHA-256 recorded. |
| Deploy and migrate once using the controlled procedure | Deployment operator | Production config gate passes; v2 NX initialization succeeds; authoritative counts/revision match review. |
| Run Production acceptance and then unfreeze editing | Client operator and engineer | Genuine passkey add/remove/revocation, setup isolation, origin rejection, concurrent edits, cleanup dry-run, rate failure, recovery, synthetic report and delivery test verified. |

Do not roll back to the legacy mutable Blob writer after v2 changes: its stale data can discard newer edits. Use a v2-aware build, or freeze and explicitly reconcile the latest authoritative state before rollback. Keep permanent deletion markers and use new photo paths. Full migration commands, prerequisite ordering, and acceptance steps are documented in [the rollout procedure](security-remediation-rollout.md).

## Scope and security limitations

This work addresses the nine assessed findings in code and adds configuration gates; operationally dependent findings remain open for Production until the handoff steps pass. The live site should not yet be described as running the fixes. The assessment is a point-in-time OWASP-aligned review, not an OWASP certification or assurance that every vulnerability has been found.

Inquiry/report encryption remains server-side, not browser-only/end-to-end encryption. Event storage was not converted to WORM storage. Console lost-device recovery deliberately retains existing keys and sessions; suspected compromise requires revocation of affected keys/sessions and credential rotation, rather than lost-device recovery alone.

## Documentation index

- This register: implemented controls, actual setting edits, validation provenance, and remaining responsibilities.
- [Security remediation rollout](security-remediation-rollout.md): cutover commands, operational acceptance, and rollback constraints.
- [PR #115](https://github.com/PaulinoTech1/Speedzone/pull/115): reviewable implementation, tests, and documentation.
- Original assessment and evidence bundle: separately delivered `speedzone-security-assessment-2026-10-10.md` and `speedzone-security-evidence-2026-10-10.zip`, including reproduction evidence and primary OWASP/vendor references.
