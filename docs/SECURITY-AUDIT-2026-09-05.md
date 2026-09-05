# SpeedZone security audit — 2026-09-05

Audited application commit: `d3e2197bc98c18dcaa6ec4262cb60c0db59c85db`.

Remediation tracking is in [SECURITY-REMEDIATION-2026-09-05.md](SECURITY-REMEDIATION-2026-09-05.md). Findings below describe the original snapshot. Its four audit probes have since been converted into prevention tests in `tests/security/audit-regressions.test.ts` and included in the normal suite; the old opt-in harness no longer exists.

The app needs security work before it should be considered ready for production use. The highest priority is a published critical vulnerability in the installed Next.js/image-processing stack. Local probes also reproduced rate-limit bypass, denial of passkey login through a shared counter, ineffective streaming body limits, and file exposure through the old local preview server. No production exploit payloads were sent and no evidence of a past compromise was established by this review.

This is a source review, dependency-advisory review, local test run, and limited live HTTP assessment. It is not proof that the app has no other vulnerabilities. No application behavior or production configuration was changed during this audit. The report and opt-in local reproduction harness are the new deliverables.

## Findings by priority

### S1 — Critical: installed image-processing dependencies match a published RCE advisory

**Evidence:** `package.json:36` pins Next.js `16.3.1`; `package.json:40` pins Sharp `0.35.3`. Runtime inspection confirmed these versions, libheif `1.23.0`, and enabled HEIF/AVIF input decoding. The official [Next.js August security release](https://nextjs.org/blog/august-2026-security-release) identifies an unauthenticated image-optimization remote-code-execution vulnerability and supplies a mitigation in Next.js `16.3.3`. The [libheif advisory](https://github.com/strukturag/libheif/security/advisories/GHSA-g89c-p67h-r497) lists `1.22.0` through `1.23.1` as affected and `1.23.2` as patched.

**App exposure:** `next.config.ts:34` permits every public Vercel Blob store and every Sanity project's `/images/**` paths. A local check using Next's actual URL matcher confirmed that unrelated tenants' URLs are accepted. Public vehicle pages use `next/image`. This creates a route for attacker-hosted images to reach the image optimizer without going through the admin-only WebP upload validator. The installed optimizer contains AVIF processing and lacks the newer mitigation.

**Limit:** vulnerable local versions and permissive configuration were confirmed. Remote code execution was not attempted, and the versions/protections of Vercel's separately managed production image service were not inspected. This is not a claim that production has already been exploited.

**Remediation:** update Next.js to at least `16.3.3` and align `eslint-config-next`; choose a Sharp/native dependency build containing patched libheif and verify the resolved native version on the deployment platform. Restrict remote images to the dealership's exact Sanity project/dataset and any actually required Blob store. Rebuild, rerun security/browser tests, and redeploy. The framework mitigation is still warranted even if the managed hosting service has separate protections.

The separate [Windows-hosted RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) requires both Pages Router and App Router. This checkout has App Router routes and no Pages Router application; that Windows-specific issue is not counted as a second confirmed vulnerability.

### S2 — High: changing User-Agent bypasses password and public-form rate limits

**Evidence:** `src/lib/server/security-log.ts:41` hashes `IP | User-Agent`; `src/lib/server/route-utils.ts:56` uses that hash as the only client bucket for password login, test-drive submissions, trade-in submissions, and VIN/recall lookups. An attacker controls User-Agent without changing their IP.

**Reproduction:** five calls from one IP/User-Agent were allowed, the sixth was rejected, and changing only User-Agent immediately allowed another call. The opt-in probes reproduce this separately for the password and test-drive policies using the real limiter.

**Impact:** the application-level limit does not reliably constrain password guessing, Argon2 work, fake leads, outbound notifications, or third-party lookups. Passkey verification remains necessary for full login; this finding does not bypass MFA. The progressive authentication delay uses the same changeable client hash. External WAF enforcement was not verified.

**Remediation:** base the enforceable client limit on a trusted, stable client-IP key, independently of User-Agent. Use deployment-wide atomic counters and an expiry policy. Retain User-Agent only as optional telemetry. Avoid a globally lockable administrator bucket as the replacement, because of S3.

### S3 — Medium: unauthenticated requests can consume the legitimate administrator's login budget

**Evidence:** `src/app/api/admin/auth/webauthn/options/route.ts:20` charges the shared `administrator-login` subject before checking password preauthentication or CSRF. `src/lib/server/route-utils.ts:48` increments the subject bucket even if the client bucket is already denied. Recovery options/verification/finalization and bootstrap registration have analogous early shared counters.

**Reproduction:** ten unauthenticated login-options requests returned 401. A different IP with a valid password-preauthentication cookie and CSRF token then received 429. Resetting only the counters made the same legitimate request return 200. No real password, real passkey, or external database was used in this probe.

**Impact:** an unauthenticated caller can cause temporary login denial on the affected worker. Rotating workers makes the exact production reach variable; it does not make the design safe. Recovery uses a shared one-hour bucket, which deserves the same correction.

**Remediation:** reject/rate-limit unauthenticated traffic by client before charging any authenticated ceremony budget. Bind later budgets to a validated preauthentication/session identifier. Do not increment protected shared counters for requests that already failed the client limit. Test normal full ceremonies and cross-client isolation together.

### S4 — Medium: rate-limit counters are neither shared across instances nor bounded in memory

**Evidence:** `src/lib/server/rate-limit.ts:19` keeps counters in a `globalThis` Map. Each worker has independent state, and restarts reset it. The map removes expired timestamps only when their exact key is reused; it never deletes expired keys or caps their count.

**Impact:** stated attempt limits are per worker, not deployment-wide. Together with S2, unique User-Agent values can create indefinitely retained keys in a warm worker. Memory exhaustion and production capacity impact were not stress-tested. `docs/WAF.md` acknowledges that process-local limits are not global and describes proposed external controls; it does not establish that those controls are active.

**Remediation:** use atomic shared counters with TTLs and bounded storage. Keep any local layer as a bounded cache. Verify the actual protections available/configured for this Hobby deployment rather than relying on the proposed WAF document.

### S5 — Low: several admin JSON limits are enforced after full buffering

**Evidence:** `src/lib/server/request.ts:270` implements `parseJsonBody()` using `request.text()` before the byte-length check. Requests without a declared Content-Length bypass the early header check. Ten admin handlers still call this parser, including recovery start, inventory mutations, and passkey verification. Authentication/CSRF requirements on these handlers remain relevant constraints.

**Reproduction:** with a 4 KiB cap, the legacy parser consumed all 256 KiB of a controlled stream before returning 413. `parseStrictJsonBody()` stopped after 8 KiB, the first chunk beyond the cap. Both ultimately reject oversized data; only the strict parser bounds buffering while reading.

**Impact:** avoidable memory/resource use before rejection. Hosting-level request limits may bound the maximum production request size; they were not measured. This is not a demonstrated unbounded Vercel upload.

**Remediation:** migrate remaining callers to the existing bounded strict JSON reader. Preserve each route's current maximum size and verify legitimate WebAuthn payloads. Strict content-type, duplicate-key, and UTF-8 checks also become consistent.

### S6 — Medium, local tool only: old preview server exposes repository files

**Evidence:** `scripts/serve.mjs:6` serves from the repository root, with no hidden-file/secret denylist or Host allowlist. The containment check at line 33 prevents escaping the root but still permits files inside it. An isolated loopback run returned 200 to HEAD requests for `/package.json` and `/.env.local`, including with an untrusted Host header. No secret contents were printed or fetched in the probe.

**Impact:** files can be read by callers able to reach that preview server. Host-header acceptance is also a prerequisite for DNS-rebinding attacks, although a browser rebinding exploit was not tested. The server binds to loopback and is not the Vercel Next.js entrypoint, so this finding is not a claim of live `.env` exposure.

**Remediation:** remove the obsolete utility or serve only a dedicated static directory with a fixed asset allowlist and accepted Host values. Do not use the repository root as a document root.

## Configuration and assurance gaps

These items are separate from demonstrated access-control vulnerabilities.

- **Current production failure:** at approximately 20:43 UTC, an empty `POST /api/test-drive` returned 503 `TD_COOKIE_CONFIG`. `/api/vin-decode?vin=INVALID` returned 500; unauthenticated inventory, session, and private-lead-read endpoints returned 503 `SERVICE_NOT_CONFIGURED`. Public test-drive and admin-login HTML returned 200. Authentication currently fails closed; these responses do not prove that every deployed storage credential is correct. Restore valid runtime configuration, redeploy, then recheck successful and rejected flows. Do not rotate established authentication secrets casually.
- **Browser test isolation:** `playwright.config.ts` blanks legacy Blob credentials but does not explicitly blank the newer Neon, Sanity, lead-storage, or email variables. If a developer later provides those through their shell or `.env*`, a test server could use real external services. The inspected local env files had none of those provider entries during this run. Add explicit isolation or dedicated test resources before relying on this harness in credential-bearing environments.
- **Incomplete admin E2E:** the virtual-passkey test successfully enrolled and logged in but failed at the Inventory heading because `/api/admin/inventory` returned 503 with Sanity unconfigured. Logout/relogin assertions later in that test did not run. Add an isolated inventory fixture rather than weakening those assertions or pointing tests at production.
- **Lead delivery reliability:** the test-drive route stores first and awaits email afterward. When email is enabled, provider failures can report an unsuccessful submission after the record already exists; retries can create duplicate leads. There is no durable notification outbox or explicit email timeout. Email is intentionally postponed in the current setup.
- **Lead retention:** no lead deletion/retention workflow or scheduled cleanup was found in the reviewed routes/configuration. Define and implement the operational retention period before accumulating customer data. This is a data-lifecycle gap, not proof that anyone can read private records.
- **Sanity access:** server queries filter published vehicles and exclude Sanity drafts, but dataset visibility and token scope require live account verification. Content Lake asset files are publicly retrievable by URL even when their dataset is private; do not assume unpublished vehicle photographs inherit private document access. See [Sanity's data safety guidance](https://www.sanity.io/docs/content-lake/keeping-your-data-safe).

## Controls reviewed without a confirmed bypass

- Admin data APIs require a complete session; a password-only preauthentication cookie is not accepted as a full session.
- Secure, HttpOnly, SameSite=Strict, host-only cookies; encrypted/authenticated cookie tokens; session expiry, epoch invalidation, and logout revocation.
- Explicit origin checks plus session-bound CSRF for admin mutations.
- WebAuthn verification requires the configured RP ID/origin and user verification. Ceremony purpose, session binding, record revision, expiry, and one-time consumption are enforced. Passkey management requires password plus existing-passkey step-up; final-passkey deletion is blocked.
- Neon uses parameterized queries and revision compare-and-swap for auth mutations. One-time marker inserts have a composite primary key. Local auth-state storage is rejected in production when the database is missing.
- Sanity uses parameterized GROQ, revision-conditional transactions, and uniqueness locks. Public pages query published records; server-side tokens are not placed in the browser client module.
- Vehicle JSON-LD escapes `<`; React renders ordinary input as text; lead email HTML escapes input. No direct attacker-controlled eval/shell execution sink was found in the reviewed application paths.
- Photo uploads require admin/CSRF checks, enforce a byte cap, validate and fully decode WebP, re-encode it, and strip metadata. These controls do not protect the separate public Next.js image optimizer in S1.
- Production HTML uses a fresh CSP nonce, strict script policy, frame blocking, nosniff, and no-referrer. Admin HTML/API responses use no-store. Browser draft encryption derives a nonextractable AES-GCM key through Argon2id and uses an IndexedDB transaction for nonce allocation; this does not establish full browser compromise resistance.

## Validation performed

| Check | Result |
| --- | --- |
| Existing Vitest suite | 30 files, 237 tests passed |
| New opt-in audit probes | 4 passed; these demonstrate the vulnerable behavior, not desired behavior |
| ESLint | Full existing tree passed; new audit harness also passed targeted lint |
| TypeScript | Passed, including the new audit harness |
| Production build | Passed; emitted local missing-inventory configuration notices |
| Production security smoke | 9 responses, 226 assertions passed; 9 distinct CSP nonces |
| Playwright Chromium | 3 passed, 1 failed because Sanity was not configured in the isolated admin test |
| npm audit | Reported 0 vulnerabilities across 534 dependencies; contradicted by current official Next.js/libheif advisories above |
| Credential-pattern scan | No matches in readable tracked files under 2 MB for selected private-key, Blob, GitHub, AWS, Resend, and credential-URL patterns; `.env.example` was the only tracked `.env*` file |
| Live HTTP probes | Limited to public HTML, unauthorized reads, invalid VIN, and an empty test-drive POST; no real lead, email, image exploit, brute-force run, or production state mutation |

Tests ran on Windows with Node `24.13.1`; the project/CI requests Node 22. A Linux/Node-22 deployment-equivalent rerun remains necessary. Credential scanning was heuristic, not a full-history or comprehensive secret audit. Live database privileges, backup/restore, private Blob mode, Sanity visibility, Vercel WAF rules, deployment-image library versions, and physical authenticator behavior were not verified. The generated `next-env.d.ts` change from browser testing was restored.

The original reproduction probes were replaced during remediation. Run their prevention regressions with:

```powershell
npm.cmd run test -- tests/security/audit-regressions.test.ts
```

The validation table above records the original audit results, before remediation. See the remediation record for current test results and remaining work.

## Recommended work order

1. Patch the image-processing dependency stack and narrow image-source scope; verify the native dependency versions in the deployed runtime.
2. Repair the current authentication configuration so legitimate requests can run, without relaxing the fail-closed checks.
3. Replace the rate-limit design to address S2, S3, and S4 together; test attacker/administrator isolation and multiple workers.
4. Migrate legacy JSON parsing, retire the preview file server, and isolate the browser test environment.
5. Verify live storage access controls and complete a real end-to-end storage check with an explicitly labeled test lead; implement retention and notification reliability before enabling email.
