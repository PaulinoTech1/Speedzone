# SpeedZone Motorsports

Mobile-first public dealership site plus a security-focused vehicle inventory portal for Vercel Pro. The application uses Next.js App Router, TypeScript, Vercel Functions, Global Config, and Blob. It does not use a third-party database or authentication provider.

## Included

- Preserved public homepage, Car Care experience, Road Trip guide, legal pages, and URLs
- Published-only inventory at `/inventory` and `/inventory/[slug]`
- Mobile admin portal at `/admin` with password plus WebAuthn passkey authentication
- Production-domain-only first-passkey bootstrap, password-plus-passkey management reauthentication, and offline recovery codes
- Draft, published, pending, sold, and archived inventory states
- Browser-side photo resize/orientation handling, metadata-stripping WebP conversion, private staging, and server byte validation
- Optional encrypted IndexedDB drafts using a separate local vault passphrase
- ETag-protected authoritative authentication state, append-only vehicle audit snapshots, and one-time security markers in private Blob
- Strict Origin/CSRF controls, host-only cookies, nonce CSP, structured security events, and layered rate limiting

## Local preview

Install Node.js 22 and run:

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

Populate `.env.local` first if you need an already-active local admin portal. Open `http://localhost:4173`; use `localhost`, not `127.0.0.1`, for local WebAuthn. First-time enrollment at `/admin/setup` is intentionally disabled in ordinary local development and Vercel Preview; provision and enroll only on the final Production HTTPS domain.

Run the verified checks:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:production-security
npm.cmd run test:e2e
```

The E2E suite starts its own isolated local server on `http://localhost:4183` and
keeps its state under `.data/e2e`.

## Production setup

Run `npm.cmd run provision-admin` on a trusted interactive workstation, then follow [docs/SETUP.md](docs/SETUP.md) for exact Global Config, Blob, Vercel environment, bootstrap, deployment, and Argon2 benchmark steps. Recovery procedures are in [docs/RECOVERY.md](docs/RECOVERY.md), and the proposed logging-first WAF rollout is in [docs/WAF.md](docs/WAF.md).

Read [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) before production use. Authentication uses uncached private-Blob reads and conditional ETag writes; its Global Config value is only an operational mirror. Inventory remains in replicated, non-transactional Global Config, so concurrent updates and stock/VIN/slug uniqueness retain the documented best-effort limits.

## Deployment status

This checkout is configured for Vercel but is not automatically published by these files. A repository commit, GitHub push, Vercel project import, production storage configuration, environment secrets, and bootstrap ceremony are separate operator actions.

The original dependency-free site is retained in `legacy-static/` as a local migration snapshot. It is not served by Next.js.
