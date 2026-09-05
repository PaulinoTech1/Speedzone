# Shared application limits and optional Vercel Firewall rules

The application enforces shared limits through Neon on every plan. Vercel Firewall configuration is an optional additional layer; no dashboard rule is claimed to be active. Verify features available on the actual Hobby account before relying on dashboard logs or paid controls.

## Application enforcement

Apply `db/003-rate-limits.sql` and the updated grants in `db/002-auth-role.sql` before deploying, including existing installations. `npm.cmd run migrate:auth-db -- --grant-role <runtime-role>` applies these alongside the existing authentication schema. Use a separate migration credential and preserve the existing auth record.

| Policy | Limit | Fixed window |
| --- | --- | --- |
| Bootstrap credentials | 3 | 30 minutes |
| Password | 5 | 15 minutes |
| WebAuthn options/verification | 10 | 15 minutes |
| Passkey management | 5 | 60 minutes |
| Recovery | 5 | 60 minutes |
| Inventory | 120 | 1 minute |
| Argon2 benchmark | 1 | 60 minutes |
| Test drive / trade-in (separate policies) | 5 each | 60 minutes |
| VIN / recall lookup (separate policies) | 20 each | 10 minutes |

Each request consumes its client's policy bucket, including malformed requests. Endpoints in a policy share that budget: allow for complete option/verify/finalize ceremonies when testing. Rejected attempts do not extend expiration. Fixed windows can allow bursts across a window boundary; these are not rolling counters.

Production uses an atomic PostgreSQL upsert and database time. Each request sweeps up to 64 expired counters using nonblocking row selection after locking its own counter. Cleanup work is bounded; total live database keys are not capped. Periodic migration maintenance also sweeps expired counters when request traffic is quiet. Missing schema, privileges or database configuration fails closed without an in-memory fallback. A database outage therefore affects public forms and lookups as well as admin operations.

Client keys use the HMAC-pseudonymized Vercel client IP independently of User-Agent. JA4 and User-Agent are telemetry, never lockout keys. Authenticated management endpoints additionally charge a validated session/administrator subject; a denied client cannot consume that subject's budget. Anonymous login, bootstrap and recovery calls cannot charge a different client's administrator budget. IP limits still group users behind one NAT and cannot stop an attack distributed across many IPs.

Local development/test counters expire and retain at most 10,000 keys. They reject new keys at capacity without evicting live counters. They are not used for production enforcement. The app trusts Vercel's overwritten client-IP header; deployment behind another proxy needs a separate trusted-proxy design.

## Optional edge layer

Start with observation for password, bootstrap, WebAuthn, recovery, passkey management, inventory mutations and public form routes. Verify available plan features and current window limits in the dashboard. If supported, use IP-based rate-limit actions and tune them using complete successful ceremonies before enforcement. A JA4 digest is shared by unrelated browsers and must not be an independent blocking key.

Verify excess requests receive 429 with a useful retry interval and a separate legitimate client can still log in. Logs must not include bodies, passwords, codes, cookies, tokens or raw credentials. Document the rule, UTC activation time, evidence and rollback. No WAF rule was created by this repository change.

Reference: [Vercel rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
