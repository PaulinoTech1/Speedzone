# Inventory admin: password and passkey recovery

Applies to the main site admin (`/admin`, `admin-inventory.speedzonems.com`). The
standalone Security Console has its own operator-armed recovery; see
[security-console-passkey-recovery.md](security-console-passkey-recovery.md).

## Threat model

| Attacker holds | Outcome |
| --- | --- |
| Recovery mailbox only | Can reset the admin password and sign out sessions (denial of service). **Cannot** sign in: password login is refused while a passkey exists, and passkeys are never removed by a password reset. Any attempt to schedule a passkey reset without a valid recovery code burns the link. |
| Mailbox + password | Same as above. Password-only setup is allowed only on a never-enrolled install or once after a completed passkey reset. |
| Mailbox + one recovery code | Can **schedule** a reset of all passkeys. The recovery mailbox is notified immediately; the reset cannot complete for 48 hours and any passkey session can cancel it from the admin page. |
| Mailbox + recovery code + 48 h without the owner cancelling | Next password sign-in retires all passkeys, signs out every session, notifies the mailbox, and issues one five-minute setup session to enroll a new passkey. |
| A stolen passkey session | Unchanged from F2: adding or removing a key needs a fresh assertion from an established key; the final key cannot be removed. |

Mailbox compromise alone must never yield admin access. Recovery codes are the
independent factor: keep them offline (printed or in a password manager), never
in the recovery mailbox.

## Flows

**Password reset (mailbox only).** `POST /api/admin/recovery` emails a 15-minute,
single-use link. `POST /api/admin/recovery/reset` replaces the Argon2id hash and
rotates the session generation. The credential epoch is unchanged, so every
enrolled passkey stays current (`src/lib/admin-recovery.ts`, `commitRecoveryScript`).

**Recovery codes.** Every successful passkey enrollment (first key or an added
key) issues ten new 20-character codes (~100 bits each), shown once in the
admin UI, replacing any earlier set. Redis stores only domain-separated SHA-256 hashes (high-entropy codes, so no slow hash is needed)
(`speedzone:admin:recovery-codes`). Existing installs get codes the next time a
passkey is added.

**Lost every passkey.** Open the emailed link, enter a recovery code under
"Lost every passkey?" (`POST /api/admin/recovery/passkey-reset`). One Lua script
consumes the link, consumes the code, and records `executeAt = now + 48h`. A wrong
code still consumes the link. The mailbox is emailed at scheduling, at
cancellation, and at completion.

**Cancel.** Signed-in passkey sessions see a banner and a "Cancel passkey reset"
button (`action: "cancel-recovery"` on `/api/admin/passkey`).

**Completion.** Only at a password-verified `POST /api/admin/login` after
`executeAt`: one script deletes all passkeys, the pending record, rotates the
session generation and sets a single-use re-enrollment flag consumed by the
initial registration commit (`src/lib/admin-passkey-recovery.ts`,
`src/lib/admin-passkeys.ts` `registrationCommitScript`).

## Limitations

- Notifications are sent at scheduling, cancellation and completion, not as
  repeated reminders during the 48 hours (no scheduler is used).
- An attacker with the mailbox can still repeatedly reset the password
  (availability, not access). Rotate the mailbox password and enable its own MFA.
- Codes are regenerated on each enrollment; reprint them after adding a key.

Tests: `tests/admin-passkey-recovery.integration.ts` (real Lua and WebAuthn
verification) prove mailbox-only access cannot enroll a passkey or retire
existing ones.
