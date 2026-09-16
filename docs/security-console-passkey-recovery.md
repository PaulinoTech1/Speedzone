# One-time Security Console passkey recovery

## First passkey setup

Production at `www.speedzonems.com` uses
`EMBEDDED_SECURITY_WEBAUTHN_ORIGIN=https://www.speedzonems.com` and
`EMBEDDED_SECURITY_WEBAUTHN_RP_ID=www.speedzonems.com`. These server settings
must match the browser's origin and domain. Redeploy after changing them.
The embedded console does not inherit `SECURITY_WEBAUTHN_*` settings from the
standalone console. An origin mismatch rejects setup before touching passkeys.

If both the current and legacy passkey stores are missing or empty, sign in
with the established password at `/Security_Console/login`. The next page
shows **Register first security passkey** without requiring a recovery code.
Complete the browser's registration prompt, then select **Use security passkey**
and verify the new key. Successful verification opens the dashboard.

Each password login permits one visit to the passkey page. Refreshing or
reopening that page revokes the session and returns to password login. Pending
passkey operations from the old session cannot complete. If a passkey was
already saved, enter the password again and verify the saved key normally.

The registration endpoint rechecks the live password session and both stores
atomically. It records a permanent bootstrap-used marker, so concurrent setup
attempts or later deletion of the credential list cannot reopen first-time
setup. Registration alone never grants an MFA session. Existing, inactive,
legacy, or malformed keys require the recovery process below; they are never
replaced by first-time setup. Storage failures disable enrollment.

## Recovery for existing credentials

Recovery allows an operator who knows the established password but cannot use
an established passkey to register one additional key. Existing passkeys and
legacy credentials are preserved. Recovery is disabled by default.

## Enable a recovery window

On a trusted operator machine, generate a random 32-byte code and its grant:

```powershell
node scripts/create-passkey-recovery.mjs
```

Set the server-only `SECURITY_PASSKEY_RECOVERY` environment variable to the JSON
object printed after `=` in the intended deployment environment, then restart
or redeploy that environment. Keep the raw recovery code private and separate
from the deployment configuration. Do not commit either value. The example
expires in one hour; accepted expiry timestamps must be in the future and no
more than 24 hours ahead. Use a fresh random code for every recovery window.

`SECURITY_BOOTSTRAP_TOKEN` is only for initial password setup; it is not a
recovery code. Existing-password login continues to use the established
credentials and configured Security Console Redis store.

## Recover access

1. Sign in at `/Security_Console/login` with the established password.
2. On the passkey page, expand the recovery section and enter the raw code.
3. Register the new passkey using the browser's authenticator prompt.
4. Select **Use security passkey** and verify with the new key to finish login.
5. Remove `SECURITY_PASSKEY_RECOVERY` from the deployment environment and
   restart or redeploy after successful recovery.

Registration does not grant dashboard access by itself. The grant is consumed
atomically when the new key is saved, and cannot enroll another key. The used
marker remains in Redis so reconfiguring the same code does not reactivate it.
Keep that marker; generate a fresh code if another recovery is necessary.

Recovery challenges expire after two minutes and are bound to the exact live
password session, credential epoch, origin, and relying party. If registration
is cancelled or the challenge expires, retry with the same code before its
grant expires, subject to rate limits. If registration succeeded but sign-in
was interrupted, sign in with the password and newly registered key normally.
Unavailable or malformed credential storage blocks recovery without replacing
stored keys. Password-only sessions cannot use normal passkey enrollment.

## Local verification

Run `npm test -- --pool=threads`, `npm run test:security-console`,
`npm run typecheck`, and `npm run lint`. The integration suite exercises real
WebAuthn verification and production Lua with an in-memory Redis adapter;
it does not verify a deployed provider or a physical authenticator.

The integration suite requires Python with `lupa==2.8`. To isolate that test
dependency on Windows:

```powershell
python -m pip install --target "$env:TEMP\speedzone-recovery-test-deps" lupa==2.8
$env:PYTHONPATH = "$env:TEMP\speedzone-recovery-test-deps"
npm run test:security-console
```
