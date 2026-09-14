# Deployment and local verification

Use Node 22. Install with npm ci, then npm run check. Use npm run dev for local work. The Vercel project root is this directory, not security-console. No data migration is required for the changes in this batch.

## Environment configuration

Copy .env.example to an untracked local environment file. Configure the same variable names separately in Vercel Production and Preview. Never copy production stores or credentials into automated tests.

- Public inventory: BLOB_READ_WRITE_TOKEN selects the public upload store. Its embedded store ID takes priority over legacy INVENTORY_BLOB_ORIGIN and BLOB_STORE_ID settings; keep fallback identifiers current.
- Customer requests: TEST_DRIVE_BLOB_READ_WRITE_TOKEN must reference a PRIVATE store. Both the writer and admin inbox require it; the public token is never a fallback.
- Encryption: TEST_DRIVE_ENCRYPTION_KEY is a 32-byte Base64URL key. Back it up securely. Do not replace it without a record migration and verified restore.
- Redis: use a complete KV_REST_API_URL/KV_REST_API_TOKEN pair or complete UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN pair. Auth and submission limiting use this same configuration.
- Auth: set the initial SPEEDZONE_ADMIN_PASSWORD and explicit WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID for each environment. Password-authenticated setup sessions permit inventory administration and first-passkey enrollment, matching current GitHub behavior. Customer requests and diagnostics require a full passkey session.
- Email: verify TEST_DRIVE_NOTIFICATION_EMAIL and ADMIN_RECOVERY_EMAIL with the business owner. Set RESEND_EMAIL_DOMAIN, RESEND_API_KEY, and RESEND_PASSWORD_RESET_API_KEY. No recipient is supplied by default. Inbox acceptance does not depend on email success.
- Logging: see security-logging.md. An unset or disabled provider sends no events externally.

## Data behavior and recovery

Inventory reads obtain the content ETag and all mutations require that revision. Public Blob cache updates can take up to 60 seconds to propagate (https://vercel.com/docs/vercel-blob). Conditional writes still reject stale revisions. Stale writes return 409; allow propagation, reload inventory and reapply the intended change. Do not deploy older unconditional writers alongside the updated application: pause admin writes for cutover and retire old writable deployments. Existing catalog arrays are retained. Export inventory before deployment and before rollback.

Removing a photo or listing removes catalog references only. Blob objects are retained to avoid broken references on partial failures or concurrent reuse. This increases storage usage. Physical cleanup requires a write pause, fresh reference reconciliation and a verified backup; there is no automatic garbage collector in this release.

Test-drive forms use one UUID per mounted form and a create-only private record. Retries with the same UUID and payload reconcile existing storage; changed payloads return 409. Refreshing the form starts a new request. Old dated submission paths remain readable. Email is best effort, not a durable outbox: staff must check the inbox if notifications fail. Do not use email as the sole record of incoming requests.

The inbox loads 20 records per cursor page in Blob storage order and sorts within each page. Load all pages to see all requests; it does not promise global newest-first ordering. Missing/corrupt records do not prevent other records loading.

## Release checks

Run lint, TypeScript, unit tests, build and Playwright. In isolated staging, verify first-passkey enrollment, login/reload/logout/expiry, concurrent inventory edits, photo removal during storage failure, synthetic customer submission and inbox retrieval, and notification delivery. Confirm provider retention, mailbox ownership and the factual privacy wording with the business owner. No live provider configuration or restore drill is implied by passing mocked tests.

The separate security-console remains unfinished and must not be publicly exposed. Root TypeScript excludes it; a root build does not validate or secure it.
