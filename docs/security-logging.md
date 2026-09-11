# Security logging and console

## Trust boundaries

The public SpeedZone application may emit sanitized, hash-linked security events. It never accepts security-console cookies and never shares inventory Redis/session namespaces with the console. The independent `security-console/` deployment is the only reader for the dedicated security Redis and provider APIs.

```text
Public app -> sanitized event ingest -> provider/archive -> security console
   inventory Redis/session                     security Redis/passkey session
```

## Configuration

Set `SECURITY_LOG_PROVIDER=axiom`, an allowlisted ingest URL, and a short-lived ingest credential only in the public app. Configure `SECURITY_KV_REST_API_URL`, `SECURITY_KV_REST_API_TOKEN`, `SECURITY_WEBAUTHN_ORIGIN`, `SECURITY_WEBAUTHN_RP_ID`, and `SECURITY_BOOTSTRAP_TOKEN` only in the security-console deployment. Do not reuse `speedzone_admin` cookies, Redis keys, or the inventory WebAuthn RP ID.

The application does not provision Vercel Drains, Axiom datasets, S3 Object Lock, KMS retention, DNS, alerting, or backups. Those are external operational controls and must be configured and verified independently.

## Event rules

Events contain request IDs, route/method, outcome, actor class, reason codes, and bounded metadata. Passwords, tokens, assertions, credentials, cookies, authorization headers, customer contact fields, vehicle descriptions, and blob URLs are prohibited. Provider/archive unavailability is reported as unavailable; it is never represented as an empty verified log.

## Recovery and residual risk

Rotate ingest credentials and bootstrap tokens through the deployment secret manager. Revoke security-console sessions by advancing its independent session generation. Review provider retention and immutable archive configuration after every deployment. Best-effort telemetry can be lost during an outage; the business request path remains fail-open for telemetry while the console fails closed for reads.
