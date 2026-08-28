# Production setup

These steps require a Vercel Pro team, the final production domain, and an interactive trusted workstation. Nothing in this repository creates or publishes external Vercel resources automatically.

## 1. Import and final domain

1. Commit and push the repository to the intended GitHub repository.
2. Import it into Vercel as a Next.js project using Node.js 22.x.
3. Add `www.speedzonems.com` and `speedzonems.com`; make `https://www.speedzonems.com` canonical.
4. Finish DNS and HTTPS before administrator enrollment.
5. Keep Production and Preview storage and secrets separate.

Initial passkey enrollment is deliberately unavailable on Preview deployments, random `*.vercel.app` deployments, temporary domains, and ordinary local development. The server permits it only when `VERCEL_ENV=production`, the configured origin is HTTPS, and that exact origin belongs to the configured RP ID. It never derives either value from `Host`, `X-Forwarded-Host`, or another request header.

## 2. Authentication database

All server-side authentication state lives in the **`SEcure_Auth`** database in Neon project **`shy-sunset-14721124`**. It holds two tables:

| Table | Contents |
| --- | --- |
| `auth_state` | One row: lifecycle state, administrator user ID, session epoch, FIDO2 passkey metadata, recovery-code hashes, revoked session hashes, and the `revision` used for compare-and-swap. |
| `auth_consume_markers` | One row per burned ceremony, step-up assertion, recovery code, or bootstrap token. The composite primary key is what makes a replay impossible. |

This database serves exactly one person. Two layers enforce that:

- **In the schema.** `auth_state` has a `CHECK (id = 1)` primary key, so a second administrator record cannot exist. `auth_state_single_administrator` additionally refuses any `ACTIVE` or `RECOVERY` record that does not name an administrator and hold at least one passkey and one recovery code, and caps the record at 20 passkeys and 10 recovery codes. Those are the same invariants the application validates, restated where direct SQL access cannot bypass them.
- **In the grants.** Create a runtime role in the Neon console that owns nothing, then apply least-privilege grants with the command below. It receives `SELECT, INSERT, UPDATE, DELETE` on those two tables and no `CREATE` right anywhere, so a leaked `AUTH_DATABASE_URL` cannot reshape the schema, drop the constraints above, or add a table of its own. Keep a **separate**, more privileged role for migrations.

The identity anchor is `ADMIN_ID`, a Vercel environment variable, not a database column: every session is validated against it, so database write access alone cannot introduce a second administrator identity. The runtime never issues DDL — if the schema is missing, every administrator request fails closed with `SERVICE_NOT_CONFIGURED` rather than creating tables from a request path.

Set this server-only Production variable, marked Sensitive:

```text
AUTH_DATABASE_URL
```

The value must be a pooled Neon connection string ending in `/SEcure_Auth?sslmode=require`. The application refuses to start an authentication request when the URL names any other database, so a pasted `neondb` string fails loudly instead of silently splitting the record across two databases. Set `AUTH_DATABASE_NAME` only if the database is ever renamed.

Use a separate Neon **branch** for Preview with its own role and connection string. Preview must never share the Production branch: enrollment, epochs, and revoked-session hashes are not test data.

Apply the schema before the first deployment, from a trusted workstation or from CI with `AUTH_DATABASE_URL` supplied as a secret:

```powershell
npm.cmd run migrate:auth-db
```

Apply the least-privilege grants once the runtime role exists:

```powershell
npm.cmd run migrate:auth-db -- --grant-role speedzone_auth_app
```

The script is idempotent, so re-running it is always safe. It applies [db/001-auth-schema.sql](../db/001-auth-schema.sql) (and [db/002-auth-role.sql](../db/002-auth-role.sql) with `--grant-role`), sweeps expired one-time markers, and prints the lifecycle state, revision, and passkey count of the authentication record followed by **every role that can reach the authentication tables**. Anything in that list beyond the owner and the single runtime role is a finding. `npm.cmd run migrate:auth-db -- --check` reports the same summary without issuing DDL, grants, or deletes. Re-run it after any schema change and as a periodic maintenance sweep.

Enable Neon point-in-time restore on this project. It is the only rollback available for the authentication record; there is no mirror and no second copy.

### Legacy authentication cutover

A deployment that already authenticated against the private Blob object `security/auth/state-v1.json`, or the older `auth_state_v1` Global Config value, is carried over automatically and exactly once:

1. Record the current lifecycle state, revision, passkey count, and recovery-code count before deploying.
2. Keep `BLOB_PRIVATE_READ_WRITE_TOKEN` (or `AUTH_GLOBAL_CONFIG`) connected during the cutover window and do not alter the legacy record.
3. Deploy. On the first authenticated request, an empty `auth_state` table is seeded once from the legacy Blob object, or from the legacy Global Config mirror, or from a fresh `BOOTSTRAP_READY` record when neither exists. The insert is `ON CONFLICT DO NOTHING`, so competing first requests cannot both seed it.
4. Run `npm.cmd run migrate:auth-db -- --check` and verify the reported lifecycle state, revision, and passkey count against step 1. Then confirm a real password-plus-passkey login.
5. Only after that login succeeds, remove `AUTH_GLOBAL_CONFIG` and redeploy. Keep `BLOB_PRIVATE_READ_WRITE_TOKEN`: audit snapshots and upload staging still use that store.

Once the `auth_state` row exists it is authoritative and both legacy sources are ignored. Never delete the row to force a reseed: a later absence can pull back stale legacy state or an empty record, and must be handled as a security incident with a reviewed point-in-time restore.

`INVENTORY_GLOBAL_CONFIG` remains migration-only for inventory. Keep the legacy inventory connection temporarily if Production already contains `inventory_state_v1`; do not create a Global Config store for a fresh installation. The application never writes Global Config, so no management API token is needed.

## 3. Blob

Connect these Production Blob stores:

1. The existing `speedzone-blbob` store for authoritative inventory state. Confirm in Vercel that its access mode is **Private** before deploying. A public store cannot protect drafts, VINs, sold/archived records, or other unpublished inventory data.
2. A private store for upload staging and audit snapshots. Authentication no longer uses Blob; it lives in `SEcure_Auth`.
3. A public store for immutable published vehicle photographs.

Connect `speedzone-blbob` with the dedicated environment-variable prefix `BLOB_INVENTORY`. Prefer Vercel's short-lived OIDC authentication: the application uses `BLOB_INVENTORY_STORE_ID` with the runtime-provided `VERCEL_OIDC_TOKEN` when both are available. A legacy/static connection may instead provide `BLOB_INVENTORY_READ_WRITE_TOKEN`.

If the existing store is connected with Vercel Blob's default `BLOB` prefix, the application accepts `BLOB_STORE_ID`/runtime OIDC or `BLOB_READ_WRITE_TOKEN` as a fallback. Dedicated `BLOB_INVENTORY_*` credentials take precedence, so do not configure the dedicated and default prefixes to different inventory stores. Keep the other store credentials separate:

```text
BLOB_PRIVATE_READ_WRITE_TOKEN
BLOB_PHOTO_READ_WRITE_TOKEN
```

Never prefix a Blob store ID, read-write token, or `VERCEL_OIDC_TOKEN` with `NEXT_PUBLIC_`; none belongs in browser code. Prefer OIDC over a long-lived inventory token where the connected Vercel project supports it. Use static tokens only as a compatibility fallback, store them as Sensitive Environment Variables, and rotate them after suspected exposure.

The authoritative inventory record is the deterministic private object `inventory/state-v1.json`. Reads use `useCache: false`. Mutations validate its schema revision, read its ETag, and replace the complete object with `ifMatch`; a competing writer is re-read and retried within a fixed bound, while a stale expected revision fails. Never manually expose, make public, or delete this object.

The authoritative administrator record is the `auth_state` row in `SEcure_Auth`, not a Blob object. `security/auth/state-v1.json` is read once during the cutover described in section 2 and never written again; leave it in place as evidence until the cutover is verified, then archive it offline.

### Legacy inventory migration

For a deployment that already stores inventory in Global Config:

1. Before deploying this version, record the legacy `inventory_state_v1` schema version, revision, total vehicle count, and counts by status. Keep `INVENTORY_GLOBAL_CONFIG` connected and do not alter the legacy record during the migration window.
2. Connect `speedzone-blbob` to Production under the `BLOB_INVENTORY` prefix (or the supported default `BLOB` fallback) and confirm that the store is Private.
3. Confirm that `inventory/state-v1.json` does not already contain unrelated or stale data, then deploy. When that object is absent, the first inventory read automatically reads `inventory_state_v1` from the legacy connection and creates the private Blob object once with overwrite disabled. Competing first reads cannot replace the winner.
4. Inspect the new private object through Vercel's authenticated control plane. Verify its schema version, revision, total vehicle count, status counts, and representative records against the values recorded in step 1. Do not expose the object through a public URL or copy its contents into logs or tickets.
5. Perform one controlled inventory edit, confirm the Blob revision increments, and verify the public published count and administrator count remain correct.
6. Only after those checks pass, remove `INVENTORY_GLOBAL_CONFIG` from the Production environment, redeploy, and repeat the count/revision checks.

If `inventory/state-v1.json` already exists, it is authoritative and the legacy Global Config value is ignored. Never delete the Blob object to force migration to run again: a later absence can reseed stale legacy data or an empty state and must be handled as a data-loss incident with a reviewed restore.

## 4. Provision the administrator offline

Use a trusted local terminal. Do not place a password or bootstrap token in a command, redirected output, transcript, screenshot, ticket, chat, or repository file.

```powershell
npm.cmd ci
npm.cmd run provision-admin
```

The interactive script:

- asks for the predetermined administrator ID;
- reads the password twice with hidden terminal input and requires an exact match;
- preserves the password exactly and hashes it locally with Argon2id;
- asks for the production RP ID and exact final HTTPS origin;
- creates an independent 32-byte `AUTH_COOKIE_SECRET`;
- creates a random 32-byte base64url bootstrap token and stores only its SHA-256 digest in the environment-variable output; and
- displays the plaintext bootstrap token once, separately from the environment values.

The password must contain 16-128 Unicode code points and no more than 512 UTF-8 bytes. Spaces, Unicode, and punctuation are preserved; there are no character-composition rules. The ID is trimmed, NFKC-normalized, and lowercased. It must be a valid email address or a 3-254-character ASCII username containing letters, digits, periods, underscores, or hyphens.

Copy the six reported variables into Vercel Production exactly:

```text
ADMIN_ID
ADMIN_PASSWORD_HASH
ADMIN_BOOTSTRAP_TOKEN_HASH
AUTH_COOKIE_SECRET
WEBAUTHN_RP_ID
WEBAUTHN_EXPECTED_ORIGIN
```

Treat the encoded Argon2id hash, bootstrap-token hash, and cookie secret as Vercel Sensitive Environment Variables. The administrator ID, RP ID, and origin are configuration, not credentials. The plaintext bootstrap token is not an environment variable: transfer it to the owner through a controlled channel and retain it temporarily in a password manager or offline record.

Optional Production values are:

```text
ADMIN_DISABLED=false
WEBAUTHN_RP_NAME=SpeedZone Motorsports
ENABLE_ENCRYPTED_LOCAL_DRAFTS=true
ENABLE_ARGON2_BENCHMARK=false
MAX_IMAGE_DIMENSION=1600
MAX_IMAGE_BYTES=4194304
```

`ADMIN_PASSWORD_PEPPER` remains supported for an existing peppered hash, but the provisioning command does not create one. Do not set it for the newly provisioned hash. `LOCAL_STATE_PATH`, `LOCAL_SECURITY_PATH`, legacy `AUTH_*` keys, and `WEBAUTHN_ALLOWED_ORIGINS` are not Production configuration for this flow.

Set the authentication variables only in Production. Leaving them absent in Preview makes administrator and setup endpoints fail closed while public inventory remains available.

## 5. Validate and deploy

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:production-security
npm.cmd run test:e2e
npm.cmd run migrate:auth-db -- --check
```

Deploy only after every check passes and `migrate:auth-db --check` reports the expected `SEcure_Auth` database, schema, and authentication record. Confirm public routes, `robots.txt`, `sitemap.xml`, CSP/security headers, and `no-store`/`noindex` on administrator routes. The automated browser harness has an explicit non-Vercel, loopback-only enrollment exception; do not set its test flag in a manual or deployed environment.

## 6. One-time enrollment

1. On the final production domain, open `https://www.speedzonems.com/admin/setup` directly.
2. Enter the predetermined administrator ID, exact password, and plaintext one-time bootstrap token. Add a recognizable label for the first authenticator.
3. Complete user verification with a platform passkey or external FIDO2 security key.
4. Save all ten recovery codes offline and acknowledge that they were saved. They are displayed once and are never sent through email or SMS.
5. Continue to `/admin/login` and perform a fresh password-plus-passkey sign-in. Enrollment itself never creates an inventory session.
6. In Security, reauthenticate with the password and an existing passkey, then register a second passkey or hardware security key stored separately.
7. Delete `ADMIN_BOOTSTRAP_TOKEN_HASH` from the Vercel Production environment and redeploy. Delete the plaintext token from its temporary storage.
8. Confirm `/admin/setup` returns 404 and a fresh password-plus-passkey login still succeeds.

The persisted `ACTIVE` state is authoritative. Once active, the server ignores the bootstrap-token hash even if removal and redeployment have not completed.

### Interrupted enrollment response

If the browser loses the response after the passkey was accepted, first try a fresh password-plus-passkey login. A successful login proves the private auth record committed; reauthenticate in Security and rotate the recovery codes because the original plaintext set was lost. If login fails, do not blindly retry or reset state. Set `ADMIN_DISABLED=true`, inspect the authoritative private object and its ETag, and determine whether it is `BOOTSTRAP_READY` or `ACTIVE`. A mirror failure does not undo a committed private-Blob activation.

## 7. Deployed Argon2 benchmark

Local timing is not a Vercel Function benchmark. Temporarily enable `ENABLE_ARGON2_BENCHMARK`, deploy, sign in, complete password-plus-existing-passkey step-up, and invoke the protected benchmark with three samples. Target a median around 250-500 ms. Never lower the encoded hash below 19,456 KiB memory, two iterations, and parallelism one. Disable the benchmark and redeploy immediately afterward.

## 8. WAF and launch

Follow [WAF.md](WAF.md). Start in Log mode, verify legitimate complete setup/login/recovery ceremonies, and then explicitly publish the rate-limit actions. Repository code does not configure or prove the production firewall.

## 9. Lead form email notifications

Two public pages email a notification through [Resend](https://resend.com) whenever a visitor submits them: `/test-drive` (`POST /api/test-drive`) and `/sell-your-car` (`POST /api/trade-in`). Neither affects authentication or inventory storage.

1. Create a Resend account and verify a sending domain (a `From` address on an unverified domain will be rejected by Resend).
2. Create an API key and set these Production variables:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
```

`RESEND_FROM_EMAIL` must be an address on the verified domain, for example `SpeedZone Motorsports <leads@speedzonems.com>`. Until both variables are set, submissions fail closed with a 503 rather than silently dropping the request.

3. Optionally set `LEAD_NOTIFICATION_EMAIL` to override the default recipient (`smpaulino.business@gmail.com`) for both forms.

Both routes are public and unauthenticated by design; they are protected only by per-client rate limiting and Zod input validation, not by CSRF or origin checks used elsewhere in this codebase for authenticated admin mutations.

## 10. VIN decoder

The trade-in form's "Decode VIN" button calls `GET /api/vin-decode`, which the server proxies to the free, public [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) (no API key, no environment variable, no cost). The browser never calls NHTSA directly, so the site's Content-Security-Policy `connect-src` does not need to allow a third-party host. If NHTSA is unreachable or a VIN can't be decoded, the form degrades to manual entry rather than blocking submission.

Official references: [Vercel environment variables](https://vercel.com/docs/environment-variables), [deployment environments](https://vercel.com/docs/deployments/environments), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [Neon connection strings](https://neon.com/docs/connect/connect-from-any-app), [Neon branching](https://neon.com/docs/introduction/branching), [Neon point-in-time restore](https://neon.com/docs/introduction/point-in-time-restore), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [Blob SDK and conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk), and [consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage).
