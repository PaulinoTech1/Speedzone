# Proposed Vercel WAF rollout

These are operator instructions, not applied production state. Do not publish enforcement without explicit approval.

## Phase 1: logging

In Vercel Project → Firewall, add custom rules whose condition is `Request Method equals POST` plus the path group below and whose action is **Log**. Keep them in logging mode through a representative login/bootstrap/recovery test window.

| Rule | Paths | Observe before enforcement |
| --- | --- | --- |
| `sz-auth-password-log` | `/api/admin/auth/password` | Administrator NAT/VPN IPs, JA4 distribution, expected retries |
| `sz-webauthn-log` | `/api/admin/auth/webauthn/*`, `/api/admin/auth/step-up/*` | Option/verify pairs and authenticator retries |
| `sz-bootstrap-verify-log` | exactly `/api/admin/auth/bootstrap/preauth` | Three-attempt setup-verification policy, owner IP, and JA4 |
| `sz-security-management-log` | bootstrap options/verify, `/api/admin/auth/recovery/*`, `/api/admin/auth/passkeys/*` | Rare setup/management operations and false positives |
| `sz-inventory-mutation-log` | `/api/admin/inventory*`, `/api/admin/uploads*` with POST/PUT/DELETE | Normal edit/photo burst size |

Review Firewall event logs by route, source IP, JA4 digest, country, status, and deployment. JA4 is a correlation signal shared by legitimate users, not a standalone identity or permanent deny indicator.

## Phase 2: proposed enforcement

After reviewing logging matches, replace or supplement the log rules with rate-limit actions returning 429:

| Name | Condition | Limit/window | Keys | Action duration |
| --- | --- | --- | --- | --- |
| `sz-bootstrap-verify-limit` | POST exactly `/api/admin/auth/bootstrap/preauth` | 3 / 10 minutes | IP and JA4 | 30 minutes |
| `sz-auth-password-limit` | POST exactly `/api/admin/auth/password` | 5 / 10 minutes | IP and JA4 | 15 minutes |
| `sz-webauthn-limit` | POST path prefix `/api/admin/auth/webauthn/` or `/api/admin/auth/step-up/` | 6 / 10 minutes | IP and JA4 | 15 minutes |
| `sz-passkey-recovery-limit` | POST/DELETE bootstrap options/verify and prefixes `/api/admin/auth/recovery/`, `/api/admin/auth/passkeys/` | 5 / 10 minutes | IP and JA4 | 60 minutes |
| `sz-inventory-mutation-limit` | POST/PUT/DELETE prefixes `/api/admin/inventory`, `/api/admin/uploads` | 120 / 1 minute | IP and JA4 | 1 minute |

Vercel Pro fixed-window counting is capped at 10 minutes. The bootstrap and password WAF rules therefore use deployable ten-minute counting windows followed by longer persistent actions, while the Functions independently enforce rolling three-attempt/30-minute bootstrap and five-attempt/15-minute password policies. The one-hour security-management policies also remain application-layer policies. WAF and Function windows are complementary controls, not equivalent counters. Action duration is separate from the counting window and may remain longer than 10 minutes.

Use a fixed-window algorithm unless operations data supports another choice. The exact dashboard labels can change; the intended Terraform-style action is `rate_limit` with keys `ip` and `ja4`, the table's limit/window, and Vercel's default rate-limit response (HTTP 429). Treat these values as logging-informed starting points and tune them only after verifying that complete option/verify/finalize ceremonies fit without false positives.

Do not create a permanent administrator lockout. If a rule causes false positives, return it to Log while investigating. Do not statically deny a JA4 digest shared with legitimate browsers.

## Application layer

The setup-verification Function applies three attempts per rolling 30 minutes to separately HMAC-pseudonymized Vercel client-IP and JA4 keys, and the password Function applies a client-scoped five-attempt/15-minute bucket. Authentication failures also receive progressive jitter. These buckets never log the submitted identifier, a raw IP, or the JA4 digest. They are defense in depth, not global enforcement: separate Function instances do not share memory, and deployments behind another proxy require a separate trusted-proxy design. Production setup is Vercel-only and rejects Preview, so it relies on Vercel overwriting its client-IP header and supplying the JA4 system header.

## Verification checklist

1. Test from the same network/browser fingerprint used for observation.
2. Confirm allowed attempts reach the Function.
3. Confirm the next attempt receives 429 and a bounded retry window.
4. Confirm normal WebAuthn option plus verify pairs fit within the rule.
5. Test recovery and photo bursts without using production recovery codes or data.
6. Confirm WAF events contain no request bodies, passwords, recovery codes, cookies, or credentials.
7. Record the rule version, UTC activation time, reviewer, evidence, and rollback action.

Reference: [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Vercel rate limiting guide](https://examples.vercel.com/kb/guide/add-rate-limiting-vercel), and [Vercel WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules).
