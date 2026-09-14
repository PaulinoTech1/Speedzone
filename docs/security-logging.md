# Security logging: implemented behavior

The main website emits sanitized events for password login, logout, passkey routes, recovery routes, inventory updates/removal/uploads and accepted customer requests. Route events record outcome/status and a safe operation label. Actor fields identify a class, not a verified individual employee; successful authenticated inventory/passkey operations use the admin class; unauthenticated or denied requests use anonymous. Shared admin access does not provide individual accountability.

Set SECURITY_LOG_PROVIDER=axiom, SECURITY_LOG_INGEST_URL and SECURITY_LOG_INGEST_TOKEN to enable best-effort HTTP delivery. The endpoint must accept the application's single JSON event format; configure an adapter if the provider expects another envelope. Non-success responses and network failures produce a local diagnostic without changing the business response. Configure alerts on those diagnostics in the provider. Disabled logging does not deliver or durably queue events.

Events omit request bodies and passkey assertions. Metadata excludes credential and customer contact keys. Event hashes are unkeyed checksums, not signatures, a chained archive, or proof against an attacker who can rewrite records. Retention, access control, archive integrity and alerting require separately configured provider controls.

There is no implemented bridge from these HTTP events to the dedicated Redis store read by security-console. The console's independent passkey screens are placeholders and its reads have not been authenticated. Do not expose that application publicly. Use restricted provider tooling until the console is secured and tested.
