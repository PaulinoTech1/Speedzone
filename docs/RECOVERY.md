# Administrator recovery and incident procedures

## Routine preparation

- Register at least two passkeys on different authenticators.
- Store the ten current recovery codes offline. Each is single-use and 130 random bits before formatting.
- Replacing codes invalidates the complete prior set; new plaintext codes are displayed once.
- The local draft-vault passphrase is separate. Passkeys and recovery codes cannot decrypt a forgotten local vault.

## Lost one passkey

1. Sign in with the password and a remaining passkey.
2. Open Security and enter the administrator password.
3. Complete a fresh assertion with an existing passkey.
4. Register and verify a replacement passkey before deleting the lost credential.
5. The API refuses to delete the final passkey.

The password-plus-passkey management proof expires after five minutes. A legacy passkey-only proof cookie is not accepted.

## Lost all passkeys, recovery codes available

1. Open `/admin/login` and choose recovery.
2. Submit the administrator ID, exact password, and one unused recovery code.
3. The authoritative record conditionally changes from `ACTIVE` to `RECOVERY` and rotates the session epoch. Existing sessions stop authorizing.
4. Register a new passkey with user verification.
5. Finalize recovery. One conditional record replacement changes `RECOVERY` to `ACTIVE`, removes all old passkeys and old recovery hashes, stores the replacement credential, rotates the epoch, and stores ten new code hashes.
6. Save and acknowledge the new plaintext codes, then perform a fresh password-plus-passkey login.
7. Register a second passkey through password-plus-existing-passkey reauthentication.

The old recovery code is not consumed in a separate write before the authoritative state commit. Concurrent or replayed finalization cannot remove a second code or overwrite the winner because it is bound to the original record revision. If the five-minute browser proof expires while the record is `RECOVERY`, restart the documented recovery form with the password and a still-current code; it does not reactivate ordinary login or rotate the epoch again.

## Interrupted first-time bootstrap

If the registration response or recovery-code screen is lost:

1. Try a fresh login using the provisioned password and newly registered passkey.
2. If it succeeds, activation committed. Complete password-plus-passkey reauthentication in Security and replace all recovery codes.
3. If `/admin/setup` returns 404 but login fails, set `ADMIN_DISABLED=true` and inspect the authoritative private auth object and ETag. Do not trust a lagging Global Config mirror or force the state backward.
4. If the authoritative state remains `BOOTSTRAP_READY`, obtain fresh registration options and retry with the same still-valid bootstrap credential. A failed challenge cannot be replayed.
5. If the authoritative state is `ACTIVE`, do not repeat bootstrap. Repair the login/configuration problem through the incident process.

A Global Config mirror failure after a private-Blob commit does not undo activation. Remove `ADMIN_BOOTSTRAP_TOKEN_HASH` only after fresh login is confirmed; once `ACTIVE`, its absence does not break login.

## Lost every passkey and every recovery code

There is intentionally no password-only, email, SMS, public registration, or hidden bootstrap bypass. Restoring `ADMIN_BOOTSTRAP_TOKEN_HASH` does not change an `ACTIVE` or `RECOVERY` record back to setup.

Use operator-controlled restoration only after independently verifying authority:

1. Set `ADMIN_DISABLED=true` and deploy.
2. Export the authoritative `security/auth/state-v1.json` private object, its ETag, the auth mirror, and relevant audit/challenge evidence.
3. Restore a verified pre-incident authoritative object or construct a separately reviewed recovery change through Vercel's control plane. Use an ETag precondition so a concurrent change cannot be overwritten.
4. Repair the Global Config mirror from that exact committed revision.
5. Rotate the password hash, `AUTH_COOKIE_SECRET`, optional password pepper, Vercel API token, and affected Blob tokens. Cookie-secret rotation also changes recovery-code hashes and therefore requires a coordinated record migration.
6. Have a second operator review the change, restore two-factor access, register two passkeys, store new codes, and re-enable the account.

Resetting the lifecycle to `BOOTSTRAP_READY` is not an application recovery feature. If an incident review authorizes that destructive reset, create a completely new offline provisioning set and verify that no credential remains. This manual process is outside the application's transactional guarantees.

## Suspected session or passkey compromise

If a trusted passkey remains, sign in and complete password-plus-existing-passkey reauthentication. Register a safe replacement before deleting a suspect credential, replace recovery codes, and revoke all sessions.

For urgent containment, set `ADMIN_DISABLED=true` and deploy. Shared authorization checks the flag for every administrator API. Investigate only sanitized security events and private audit snapshots; never put passwords, bootstrap tokens, recovery codes, cookies, or complete WebAuthn responses in a ticket.

## Ambiguous or failed storage operation

Keep the administrator disabled until an uncached read of the authoritative private object establishes its lifecycle and revision. A consumed WebAuthn challenge can be replaced; do not delete a consume marker to replay it. If the state write committed but its response or mirror write failed, accept the private object as authoritative and reconcile the mirror. If the state write did not commit, request a fresh challenge and retry only from the state the server currently reports.
