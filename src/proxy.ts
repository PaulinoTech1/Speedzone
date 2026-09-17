import { NextRequest, NextResponse } from "next/server";

// The admin portals live on dedicated subdomains. Rewrite portal-bound hosts
// to their app routes. Real routes (API, Next.js internals, static files) and
// paths already under the portal prefix are served untouched on every host.
const PORTALS: Array<{ hosts: string[]; prefix: string }> = [
  {
    hosts: [
      "admin-inventory.speedzonems.com",
      "www.admin-inventory.speedzonems.com",
    ],
    prefix: "/admin",
  },
  {
    hosts: [
      "security-console.speedzonems.com",
      "www.security-console.speedzonems.com",
    ],
    prefix: "/Security_Console",
  },
];

// Portal paths exist only on their dedicated subdomains. On any other host
// they 404, so the portals are unreachable from the main domain.
const PORTAL_HOSTS = new Set(PORTALS.flatMap((portal) => portal.hosts));
const PORTAL_PREFIXES = PORTALS.map((portal) => portal.prefix);

function isPortalPath(pathname: string): boolean {
  return PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function portalRewriteTarget(request: NextRequest): URL | null {
  const host =
    (request.headers.get("host") ?? "").toLowerCase().split(":")[0] ?? "";
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".")
  ) {
    return null;
  }

  for (const portal of PORTALS) {
    if (portal.hosts.includes(host) && !pathname.startsWith(portal.prefix)) {
      const url = request.nextUrl.clone();
      url.pathname = `${portal.prefix}${pathname}`;
      return url;
    }
  }
  return null;
}

export function proxy(request: NextRequest) {
  const host =
    (request.headers.get("host") ?? "").toLowerCase().split(":")[0] ?? "";
  const { pathname } = request.nextUrl;

  if (isPortalPath(pathname) && !PORTAL_HOSTS.has(host)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestId = request.headers.get("x-request-id")?.match(/^[A-Za-z0-9._-]{8,96}$/)?.[0] ?? `req_${crypto.randomUUID()}`;
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    isDevelopment
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self' https://vercel.com",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", csp);

  const rewriteTarget = portalRewriteTarget(request);
  const response = rewriteTarget
    ? NextResponse.rewrite(rewriteTarget, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

export const config = {
  matcher:
    "/((?!_next/static|_next/image|assets|favicon.ico|manifest.webmanifest).*)",
};
