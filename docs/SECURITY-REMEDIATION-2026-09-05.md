# Security remediation — 2026-09-05

The local changes address the six findings in [the audit](SECURITY-AUDIT-2026-09-05.md). S1 has a verified application mitigation; its dependency upgrade is still blocked. Production deployment, the Neon migration and live provider configuration have not been completed. Do not treat local tests as verification of the deployed site.

## Findings and changes

| Finding | Local remediation | Remaining deployment work |
| --- | --- | --- |
| S1: image-processing dependencies | Disabled the public Next.js image optimizer; production smoke confirms `/_next/image` returns 404. Removed all-tenant Blob/Sanity image patterns, allowed only the configured Sanity project/dataset in image configuration and CSP, and disabled remote redirects. Admin uploads continue to accept and re-encode verified WebP only. | Upgrade Next.js, its ESLint config and Sharp; verify native libheif on Linux/Node 22; redeploy. Installed dependencies remain vulnerable versions. |
| S2: User-Agent rate-limit bypass | Rate keys and progressive failure tracking use the IP hash independently of User-Agent. Regression tests rotate User-Agent through the limit and require continued denial. | Apply the shared-counter migration and deploy. IP limits cannot prevent distributed-IP attacks. |
| S3: anonymous shared-budget lockout | Anonymous login/bootstrap/recovery routes charge only client budgets. Authenticated subject budgets are charged only after authorization and successful client-limit checks. A valid login from another client remains available after anonymous traffic exhausts its own limit. JA4 no longer independently locks out unrelated browsers. | Exercise complete ceremonies in the deployed environment. |
| S4: process-local/unbounded counters | Production uses an atomic Neon upsert, database time, fixed expirations and bounded expired-row cleanup. Local-only counters expire and cap retained keys at 10,000 without evicting live limits. | Apply `003`, update grants and validate actual concurrent database requests. Missing storage fails closed. |
| S5: buffering before JSON size checks | The compatibility parser delegates to the strict streaming reader. Both entrypoints reject oversized streams after the first over-limit chunk and reject malformed UTF-8, duplicate and prototype keys. | Deploy. Existing route size caps are preserved. |
| S6: repository file exposure | Retired `scripts/serve.mjs`; it prints guidance and exits with code 1 without opening a listener. | Use `npm.cmd run dev` for local preview. |

Image optimization stays disabled even after an eventual package upgrade until native versions are checked and the mitigation is deliberately reviewed. This may increase image transfer sizes; the app's uploaded images are already resized WebP. Broad image-source permissions must not be restored. The dependency targets are based on the [Next.js security release](https://nextjs.org/blog/august-2026-security-release) and [libheif advisory](https://github.com/strukturag/libheif/security/advisories/GHSA-g89c-p67h-r497).

The SQL cleanup selects expired rows after obtaining the active counter's result, excludes that counter, and uses `FOR UPDATE SKIP LOCKED`. It avoids blocking on another request's cleanup rows. Its upsert and dependent cleanup use PostgreSQL [data-modifying CTEs](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING). Tests exercise the database decision boundary with mocked responses; they do not establish live SQL/concurrency behavior. PostgreSQL was unavailable locally and Docker's engine was not running.

## Additional audit gaps

- **Test isolation:** Playwright explicitly clears Neon, Sanity, lead Blob, email and legacy provider credentials and only accepts the fixed localhost test origin. The admin browser test verifies the real authenticated session before returning a local inventory fixture. Bootstrap, passkey login, logout and fresh login all run; no production inventory is used.
- **Lead delivery:** a successful Blob write is the acceptance boundary. A notification failure cannot turn that saved submission into an error inviting a duplicate retry. Email has a five-second timeout and requires an explicit recipient; there is no default address. Email remains optional for test drives and required for trade-ins. Delivery is best effort, with no outbox or automatic resend; keep notifications disabled until that operational limitation is accepted.
- **Retention:** `scripts/lead-retention.mjs` implements paginated cleanup restricted to expired UUID-named test-drive records. It requires an explicit retention period, defaults to a dry run, and requires `--apply` to delete. Tests cover namespace isolation, date filtering, pagination, invalid periods and dry-run behavior. No real data was listed or deleted, and no schedule or retention period was activated. Commands are in [SETUP.md](SETUP.md#lead-retention).
- **Cloud configuration:** no connected browser or callable Vercel/Neon/Sanity account connector was available. Current runtime secrets, private Blob mode, Sanity dataset visibility/token scope and deployed migration state remain unverified. Preserve existing valid authentication secrets and legacy auth sources. Listed Production variable names and Blob list operations do not establish a successful write path.
- **Sanity photos:** private datasets do not make asset URLs private. Upload only photographs intended to be public. Dataset visibility and token scope need verification in the actual account; see [Sanity's guidance](https://www.sanity.io/docs/content-lake/keeping-your-data-safe).

## Completion sequence

1. Complete the dependency update from the repository root when installation is available:

   ```powershell
   npm.cmd install --save-exact next@16.3.4 sharp@0.35.4 eslint-config-next@16.3.4
   node -e "const s=require('sharp'); console.log({next:require('next/package.json').version,sharp:s.versions.sharp,heif:s.versions.heif})"
   ```

   Verify the resolved native libheif is at least `1.23.2`, and repeat this check on the Linux/Node-22 build used for deployment. Review and commit both dependency manifest and lockfile. The attempted install during this run was rejected by automatic approval review because its usage limit was reached; neither dependency file was changed.

2. With the separate migration credential supplied securely as `AUTH_DATABASE_URL`, apply the migration and runtime grants. Replace `speedzone_auth_app` with the actual existing runtime role:

   ```powershell
   npm.cmd run migrate:auth-db -- --grant-role speedzone_auth_app
   npm.cmd run migrate:auth-db -- --check
   ```

   Apply before deploying these changes, including on an existing installation. Confirm access to `security_rate_buckets` with the runtime credential as well. Preserve `auth_state`, epochs, passkeys, recovery hashes and legacy migration sources. Verify concurrent requests with an isolated test key in a separate Neon test branch before production.

3. Resolve runtime configuration through Vercel's protected environment UI. Verify `AUTH_COOKIE_SECRET` is canonical unpadded base64url for at least 32 random bytes; preserve a valid existing secret. A configured pepper must be independent and match the password hash's provisioning. Verify the `SEcure_Auth` URL and runtime grants. Verify the private lead store is `store_8wyMMbqPZkpgwRwg`, with server-only `Test_Drive` and `Test_Drive_STORE_ID`. Leave all email variables unset for now. Use separate production and preview resources.

4. Rerun validation, commit the intended files, then push/deploy after the migration and configuration are confirmed:

   ```powershell
   npm.cmd run check
   npm.cmd run test:production-security
   npm.cmd run test:e2e
   ```

5. Verify deployed image requests still return 404, authorized and rejected admin flows, and a clearly labeled test-drive submission saved exactly once in private Blob. Confirm no email is sent. Check the deployed Git revision and native image-library versions. A successful empty-body rejection only checks the security/validation path, not Blob writes.

## Local validation

- Vitest: **33 files, 262 tests passed**. The original four audit probes are now prevention regressions in the normal suite.
- ESLint and TypeScript: passed.
- Production build: compiled, type-checked and generated all routes. A later Windows cleanup error in a generated `.next/static` directory was resolved by removing only that verified build-output directory and rebuilding.
- Production security smoke: **10 responses, 227 assertions passed**, including the disabled image optimizer; nine distinct CSP nonces.
- Playwright mobile Chromium: **4 passed**, including bootstrap, login, logout and relogin. Inventory uses an isolated fixture; this is not a Sanity integration test.
- Retired preview command: exited with code 1 and no listener.

Validation used Windows with Node `24.13.1` and the installed, unupgraded dependencies. Missing local Sanity configuration produces empty public inventory during the build. Live database execution, Linux/Node 22, actual provider settings, real Blob writes and physical authenticators remain outside these results. No production mutation or deployment was performed.
