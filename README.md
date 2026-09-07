# SpeedZone Motorsports

Public Next.js website for SpeedZone Motorsports. The site includes dealership information, contact links, car-care guidance, road trips, a buying-cost calculator, and a link to the official NHTSA recall lookup.

## Run

Requires Node.js 22.

```sh
npm ci
npm run dev
```

Open http://localhost:4173. No application environment variables are required.

## Validate

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Deploy

Deploy this repository as a Next.js project on Vercel with `npm run build`. The repository uses npm and package-lock.json.

## Reset baseline

Authentication, administrator pages and APIs, password recovery, passkeys, database access, CMS integration, uploads, and online test-drive/trade-in submissions have been removed. Inventory and sell-your-car pages provide direct contact links. New functionality can be designed from this public-site baseline.

This source reset does not delete hosted databases, stored leads, Sanity content, Vercel resources, remote credentials, or the separate sibling Studio repository. Those resources are outside this website's runtime and require a separate retirement decision. Local ignored environment/data files are not consumed by application code.
