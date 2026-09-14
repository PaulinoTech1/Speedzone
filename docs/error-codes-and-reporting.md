# Internal diagnostics and responsible bug reporting

## Error-code contract

The server registry is `src/lib/diagnostics.ts`. Verbose codes combine a stable operation name and failure class, for example `SPEEDZONE_INVENTORY_LISTING_UPDATE_STATE_REVISION_OR_IDEMPOTENCY_CONFLICT`. Each entry includes a description and remediation guidance. These classify where and how a request failed; they do not claim a verified root cause.

Root API handlers use `withDiagnostics`. The authenticated inventory-upload readiness GET preserves the newer GitHub ready/error response contract and records a diagnostic explicitly. Successful bodies, cookies and upload/image protocols are preserved. Exceptions and explicit 5xx responses return a generic message plus an opaque UUID. Existing actionable 4xx validation messages remain; internal codes are never attached to them. An opaque support-reference header permits correlation. Passkey administrators retrieve the verbose registry and recent records from `/api/admin/diagnostics`; anonymous, setup and expired sessions cannot read them. The admin screen renders report text as escaped text, never executable HTML or links.

Next's server error hook records framework/render failures. Generic error boundaries avoid displaying exception contents. Client-only errors are not automatically transmitted: visitors can submit the responsible-report form. The unfinished separate security-console is outside this implementation and remains unsuitable for public exposure.

Records contain only registry-defined operation/code/guidance, numeric status, timestamp and a generated reference. No request body, query string, stack, exception message, cookie, token or customer contact is copied into diagnostics. Each code is sampled once per minute across instances; repeated occurrences share the sampled reference. Up to 500 references are indexed, the latest 100 are displayed, and each stored record expires after seven days. Diagnostic storage failure never changes the business result. Restricted server logs provide fallback diagnostics if Redis is unavailable; configure platform retention/access separately.

When adding a route, add its operation to the registry, wrap the handler, and test both public redaction and authenticated diagnostics access. Use explicit `recordDiagnostic` calls for failures that intentionally return success, such as email notification after durable acceptance. Never pass untrusted strings as code names or attach provider exception objects.

## Report intake

The public page is `/report-a-problem`; intake is POST `/api/bug-reports`. Reports remain private. This page does not authorize penetration tests, a reward program, disclosure deadlines, or a legal safe harbor. Staff review through the existing passkey-protected admin page. No emails, attachments, URL fetches or automatic publishing are performed.

Controls implemented:

- Configured exact Origin check; reject cross-site/same-site Fetch Metadata. Origin is a browser cross-site control, not proof of identity; non-browser clients can forge it.
- JSON-only requests, unknown-field rejection, strict field types and lengths, path-only page references, 8,192-byte streamed limit and five-second body-read timeout.
- One atomic Redis admission script with limits of 2 attempts/hour and 5/day per client, 20/hour and 50/day site-wide. Counters expire from their first attempt; admission checks all buckets before incrementing. Invalid admitted submissions consume capacity. 429 includes Retry-After. Storage/limiter/encryption outage rejects intake.
- On Vercel, use the platform's forwarded client address, HMAC it with a dedicated secret, and never store raw IPs in these keys. Outside Vercel callers share a strict bucket. Site-wide caps remain effective even when client addresses vary. Verify the trusted ingress chain before adding another proxy/CDN; do not trust arbitrary forwarding headers on a self-hosted deployment.
- AES-256-GCM with a dedicated key and random nonce; atomic encrypted write and bounded index. Each report expires after 30 days, independently of index activity. Index retains the newest 200 references and the admin view reads up to 100; unreadable records do not hide healthy records.
- Escaped text rendering, no attachments or auto-opened report URLs, private/no-store admin responses, and full passkey authentication enforced server-side.

Set BUG_REPORT_ORIGIN (exact scheme/host/port, no trailing slash), BUG_REPORT_ENCRYPTION_KEY (random 32-byte Base64URL key) and BUG_REPORT_RATE_LIMIT_SECRET (independent random secret at least 32 characters), plus existing Redis settings. No production/preview secrets or provider changes are provisioned by this code. Back up the encryption key securely and retain it until its reports expire. Encryption key changes without migration make older reports unreadable. Global caps can temporarily block legitimate reporters under attack; review rather than automatically relaxing them. Configure Vercel WAF/edge rate limits separately to contain requests before they incur function costs.

## OWASP alignment and verification limits

This is an implementation mapped to OWASP guidance, not a certification or blanket claim of compliance:

- [Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html): generic unexpected errors; restricted internal diagnostics.
- [REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html): content-type, size/type validation, throttling and authorization.
- [Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html): server-side allowlists and bounded fields; validation complements output encoding.
- [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): exclude sensitive payloads and restrict diagnostic access.

Before deployment, verify real concurrent Redis admissions, TTL expiry, staging passkey access, Vercel ingress headers, WAF limits, key continuity and operational alerting. Mocked unit tests do not establish live provider behavior or availability. Platform/framework logs may have their own data handling; this change does not certify every historical logging path.
