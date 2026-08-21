# Production setup

These steps require a Vercel Pro team, the final production domain, and an interactive trusted workstation. Nothing in this repository creates or publishes external Vercel resources automatically.

## 1. Import and final domain

1. Commit and push the repository to the intended GitHub repository.
2. Import it into Vercel as a Next.js project using Node.js 22.x.
3. Add `www.speedzonems.com` and `speedzonems.com`; make `https://www.speedzonems.com` canonical.
4. Finish DNS and HTTPS before administrator enrollment.
5. Keep Production and Preview storage and secrets separate.

Initial passkey enrollment is deliberately unavailable on Preview deployments, random `*.vercel.app` deployments, temporary domains, and ordinary local development. The server permits it only when `VERCEL_ENV=production`, the configured origin is HTTPS, and that exact origin belongs to the configured RP ID. It never derives either value from `Host`, `X-Forwarded-Host`, or another request header.

## 2. Global Config

Create and connect two Production Global Config stores:

- `speedzone-inventory-production`
- `speedzone-auth-production`

Record each connection string and Config ID. The application stores inventory in `inventory_state_v1`. The `auth_state_v1` value is only a best-effort operational mirror of the authoritative private-Blob authentication record; it is never used to authorize a request after the private object exists.

Create a Vercel Access Token able to update the stores through the management REST API, then set these server-only Production variables:

```text
INVENTORY_GLOBAL_CONFIG
AUTH_GLOBAL_CONFIG
INVENTORY_GLOBAL_CONFIG_ID
AUTH_GLOBAL_CONFIG_ID
GLOBAL_CONFIG_TEAM_ID
GLOBAL_CONFIG_API_TOKEN
```

The runtime token is broader than a store-only credential. Use the narrowest available team/account scope and rotate it. Global Config is non-transactional, so inventory concurrency and uniqueness remain best effort. Authentication does not rely on those semantics.

## 3. Blob

Create and connect two Blob stores:

1. A private store for authoritative authentication state, one-time challenge markers, upload staging, and audit snapshots.
2. A public store for immutable published vehicle photographs.

Set server-only Production tokens:

```text
BLOB_PRIVATE_READ_WRITE_TOKEN
BLOB_PHOTO_READ_WRITE_TOKEN
```

Do not prefix these names with `NEXT_PUBLIC_`. The authoritative administrator record is the deterministic private object `security/auth/state-v1.json`. Reads bypass cache. Mutations validate its revision and use its ETag with `ifMatch`; a competing writer must re-read, while a stale expected revision fails. The committed private object remains authoritative if the later Global Config mirror write fails.

On first installation, a missing private object is created once from the auth mirror or the empty versioned schema. Verify any existing mirror before first deployment. Never manually delete the private object: deletion can reseed from a stale mirror and must be treated as a security incident.

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
```

Deploy only after every check passes. Confirm public routes, `robots.txt`, `sitemap.xml`, CSP/security headers, and `no-store`/`noindex` on administrator routes. The automated browser harness has an explicit non-Vercel, loopback-only enrollment exception; do not set its test flag in a manual or deployed environment.

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

Official references: [Vercel environment variables](https://vercel.com/docs/environment-variables), [deployment environments](https://vercel.com/docs/deployments/environments), [Global Config SDK](https://vercel.com/docs/global-config/global-config-sdk), [Global Config REST writes](https://vercel.com/docs/global-config/vercel-api), and [Blob conditional writes](https://vercel.com/docs/vercel-blob#conditional-writes).
