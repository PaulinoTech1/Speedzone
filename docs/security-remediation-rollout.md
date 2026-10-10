# Security remediation and controlled rollout

Assessment date: 2026-10-10. Reviewed base commit: `1d920e9552760ad0c8faaf8eaaf79f02a47736eb`.

For the complete change register, exact Vercel setting edits, validation results, and responsible-role handoff, see [security-remediation-summary-2026-10-10.md](security-remediation-summary-2026-10-10.md).

## Changes and remaining work

| Finding | Remediation | Release requirement |
| --- | --- | --- |
| F1: setup token grants inventory/customer access | Password setup lasts five minutes and authorizes initial enrollment only. Enrollment atomically consumes the setup session and rotates its generation. Protected inventory, requests, and diagnostics require a passkey session. | Deploy and verify an existing setup token receives 401 on private APIs. The Production admin cookie now uses the host-only `__Host-` prefix; browsers sign in again. |
| F2: session theft permits passkey changes | Add/remove requires a fresh, user-verified assertion by an established key. Five-minute, one-use grants bind the action, target, session, generation, and epoch. Commit Lua rechecks live authorization and consumes the grant. Removal revokes other sessions and older grants while preserving the current session. Managed enrollment retains its authorizing session; initial setup exchanges only its committed generation. | Verify both admin and console with genuine authenticators. The last usable key remains protected. |
| F3: Preview receives Production credentials | Vercel scopes for the console Redis credentials, admin bootstrap password, logging ingest configuration, and Turnstile secret were changed to Production only. | Rotate exposed credentials at their providers and update Production. Existing deployment snapshots retain old environment values. Retire historical Preview deployments and restrict old Production deployments. Use independent Preview databases/tokens if Preview authentication is needed. |
| F4: cleanup accepts sibling-origin/simple requests | Cleanup, inventory writes/uploads, and passkey changes require the exact configured request origin. Mutations require bounded JSON, reject `text/plain`, and reject cross-site Fetch Metadata. | Confirm `WEBAUTHN_ORIGIN` is the inventory admin origin. Browser requests from another sibling subdomain must fail. |
| F5: stale CDN data paired with fresh ETag loses edits | One Redis document is authoritative for both the catalog and revision. Lua performs compare-and-set edits. Immutable Blob backups precede commits. The old Blob delivery URL is a read-only fallback. | Complete the controlled inventory cutover below. No Production inventory was migrated during remediation. |
| F6: orphan cleanup races uploads/attachments | Upload paths receive 24-hour leases and cannot be overwritten. Cleanup considers only photos at least 24 hours old, claims at most 100 per request, and atomically checks the catalog revision/references. Permanent deleting/deleted markers prevent later attachment. Physical removal after listing changes is deferred to cleanup. | Old writers must be stopped before migration. If deletion fails after a claim, retry cleanup; upload to a new path when replacing a claimed/deleted photo. |
| F7: limiter timeout fails open | Login and test-drive limits have a two-second deadline and return unavailable on the library's timeout result or provider exception. | Verify provider failure returns 503 and does not create sessions or accept submissions. |
| F8: vulnerable dependencies | Both manifests/locks upgrade Next to 16.3.8, sharp to at least 0.35.5, and source-map-js to at least 1.2.2. Node/CI target 24. | Use the locks with `npm ci`; run dependency audits in both projects. |
| F9: missing recovery/reporting/delivery settings | Added Production reporting origin, independent reporting encryption/rate secrets, independent delivery-test secret and target. Recovery now returns unavailable if configuration is missing and uses the canonical admin origin. Production prebuild validates required settings. Admin readiness reports booleans without secret values. | Supply the exact owner recovery mailbox as `ADMIN_RECOVERY_EMAIL`, redeploy, and test recovery/reporting/delivery through the intended operators. |

Environment changes apply to future deployments. The running Production deployment has not been replaced by this branch. Credential scope changes cannot invalidate tokens already copied into older deployments. Do not regard F3 or F9 as fully closed until their provider and delivery checks are complete.

## Inventory cutover

1. Schedule a short admin editing freeze. Keep an independently retained export/backup of the known latest inventory and record listing/photo counts. Protect access to all older deployment URLs that can still run the old mutable Blob writer or cleanup route.
2. Configure the owner recovery mailbox and rotate the exposed provider credentials. Confirm the main and independent console Redis databases are distinct. Run `npm run check:security-config` with `VERCEL_ENV=production` in the target environment. Do not print environment values into a terminal transcript or CI log.
3. Deploy this branch to the target environment. Until v2 state exists, the public catalog remains readable from the legacy source, while edits and cleanup are blocked. Verify private APIs require passkey authentication. Keep old deployments from accepting writes throughout cutover.
4. Obtain the latest legacy JSON using an operator-controlled export. Review it against recent business changes, listing IDs, photos, and the retained backup. A fresh Blob ETag does not establish freshness of a CDN response. Do not automatically adopt an unreviewed public CDN body.
5. Validate the reviewed local JSON without writing:

   ```sh
   npm run migrate:inventory -- --file /secure/path/reviewed-inventory.json
   ```

   Record the reported SHA-256 and counts. JSON must be an array of vehicles. The script rejects duplicate IDs, excessive size/counts, and malformed required fields. Absolute photo URLs are normalized so alternate spellings cannot bypass deletion markers.
6. In an operator environment with the correct target Redis and Blob credentials, initialize once:

   ```sh
   npm run migrate:inventory -- --file /secure/path/reviewed-inventory.json --apply --sha256 REVIEWED_SHA256
   ```

   The script refuses a mismatched hash and uses Redis `NX` so it cannot replace existing v2 state. An intentionally empty catalog also requires `--allow-empty`. It writes an immutable public-data backup before initializing. A failed operation can leave an unused backup, which is not authoritative.
7. Verify `/api/inventory` listing/photo counts and the returned v2 revision. As a passkey-authenticated admin, verify readiness and a reviewed edit. Concurrent edits must return 409 instead of dropping another editor's change. Verify cleanup with a dry run before confirmation, then end the editing freeze.

The v2 document is `speedzone:inventory:catalog:v2` in the main application's Redis. It contains `{ version: 2, revision, vehicles }`. Keep Redis persistence, access controls, and backups enabled. Revision-specific Blob history is a recovery aid, not a substitute for Redis durability.

**Rollback:** do not restore the old mutable Blob writer after v2 edits begin. Its catalog will be stale and can discard newer changes. Use a build that understands v2, or freeze writes and explicitly reconcile/export the latest authoritative state before any rollback. Never remove deletion markers to reuse an old photo path.

## Release validation

- Run root lint, type checking, unit tests, real WebAuthn/Lua integration tests, build, and Playwright tests. Run standalone console build/tests and dependency audits in both directories.
- Use isolated installs/checkouts when testing the two deployments. Root validation runs before installing the standalone console's nested dependencies in CI, so mocks and framework request state use the same packages as the root deployment.
- Confirm password-only setup shows no customer request data, expires within five minutes, and cannot be reused after enrollment. Confirm server behavior directly as well as UI state.
- Confirm adding/removing keys prompts for the existing authenticator. Test action-grant replay, target mismatch, and session revocation during registration. Confirm removal invalidates another authenticated session.
- Confirm sibling origins, non-JSON requests, oversized streams, rate-provider timeouts, stale revisions, leased uploads, and attachments after cleanup claims fail safely.
- Send recovery only to the configured verified owner mailbox. Perform a delivery test and submit a synthetic report, then verify its receipt/decryption in the console. Remove synthetic data according to the normal operator process.

## Boundaries

This patch closes the nine findings in code and establishes configuration gates; some findings require the operational steps above to close in Production. It does not establish OWASP certification or guarantee the absence of other vulnerabilities.

The assessment's additional observations were not claimed as completed architectural changes: inquiry/report encryption remains server-side, and event storage is not WORM storage. Console lost-device recovery deliberately retains previously enrolled keys and sessions; it must not be used as the complete response to suspected credential compromise. That response requires revoking affected keys/sessions and rotating credentials through the operator controls.
