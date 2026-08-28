# SpeedZone Motorsports

Mobile-first public dealership site plus a security-focused vehicle inventory portal for Vercel Pro. The application uses Next.js App Router, TypeScript, Vercel Functions, the `SEcure_Auth` Neon Postgres database for all server-side authentication state, and Sanity for vehicle inventory and photographs. It uses no third-party authentication provider, and Sanity Studio is never deployed — all editing goes through the passkey-gated `/admin` portal.

## Included

- Preserved public homepage, Car Care experience, Road Trip guide, legal pages, and URLs
- Published-only inventory at `/inventory` and `/inventory/[slug]`
- Mobile admin portal at `/admin` with password plus WebAuthn passkey authentication
- Production-domain-only first-passkey bootstrap, password-plus-passkey management reauthentication, and offline recovery codes
- Draft, published, pending, sold, and archived inventory states
- Browser-side photo resize/orientation handling, metadata-stripping WebP conversion, and server byte validation before every Sanity asset upload
- Optional encrypted IndexedDB drafts using a separate local vault passphrase
- Revision-gated authentication state and one-time security markers in `SEcure_Auth`; inventory uniqueness (stock number, VIN, slug) enforced by atomic Sanity transactions
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

Run `npm.cmd run provision-admin` on a trusted interactive workstation, apply the authentication schema with `npm.cmd run migrate:auth-db`, then follow [docs/SETUP.md](docs/SETUP.md) for exact `SEcure_Auth`, Sanity, Vercel environment, bootstrap, deployment, and Argon2 benchmark steps. Recovery procedures are in [docs/RECOVERY.md](docs/RECOVERY.md), and the proposed logging-first WAF rollout is in [docs/WAF.md](docs/WAF.md).

Read [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) before production use. Authentication reads the single `auth_state` row in `SEcure_Auth` uncached and commits with a `revision` compare-and-swap. Each vehicle is its own Sanity document; stock number, VIN, and slug uniqueness is enforced by a dedicated lock document created in the same all-or-nothing transaction as the vehicle write, and per-document edits are gated on Sanity's own revision (`ifRevisionId`), so a stale writer cannot silently overwrite a newer one.

Vehicle inventory and photographs live in a private Sanity dataset, read and written only from the server with an Editor-scoped API token. No browser code talks to Sanity directly, and no Studio is deployed.

## Deployment status

This checkout is configured for Vercel but is not automatically published by these files. A repository commit, GitHub push, Vercel project import, production storage configuration, environment secrets, and bootstrap ceremony are separate operator actions.

The original dependency-free site is retained in `legacy-static/` as a local migration snapshot. It is not served by Next.js.
