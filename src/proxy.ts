import { NextRequest, NextResponse } from "next/server";

import {
  buildContentSecurityPolicy,
  CDN_DOCUMENT_PREFIX,
  INTERNAL_RENDER_HEADER,
  INTERNAL_RENDER_MARKER,
  isPrivatePath,
  NO_STORE_CACHE_CONTROL,
  shouldServeCachedDocument,
} from "@/lib/public-cache";

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

// The security console moved to its own Vercel project. Its former mount and
// subdomain on this site 404 rather than redirect, so they never reveal it.
const RETIRED_HOSTS = new Set([
  "security-console.speedzonems.com",
  "www.security-console.speedzonems.com",
]);

function isRetiredConsolePath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === "/security_console" || lower.startsWith("/security_console/");
}

export function proxy(request: NextRequest) {
  const host =
    (request.headers.get("host") ?? "").toLowerCase().split(":")[0] ?? "";
  const { pathname } = request.nextUrl;

  if (RETIRED_HOSTS.has(host) || isRetiredConsolePath(pathname)) {
    return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  if (isPortalPath(pathname) && !PORTAL_HOSTS.has(host)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // The cached-document handler is only reachable through the rewrite below.
  if (pathname === CDN_DOCUMENT_PREFIX || pathname.startsWith(`${CDN_DOCUMENT_PREFIX}/`)) {
    return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
  }

  const requestId = request.headers.get("x-request-id")?.match(/^[A-Za-z0-9._-]{8,96}$/)?.[0] ?? `req_${crypto.randomUUID()}`;
  const isDevelopment = process.env.NODE_ENV === "development";
  const rewriteTarget = portalRewriteTarget(request);

  // Anonymous public page navigations: the CDN-cached document carries its own
  // hash-based CSP (see src/app/cdn-document). No nonce, no CSP set here.
  if (!isDevelopment && shouldServeCachedDocument({ method: request.method, pathname, headers: request.headers, isPortalHost: PORTAL_HOSTS.has(host) })) {
    const url = request.nextUrl.clone();
    url.pathname = `${CDN_DOCUMENT_PREFIX}${pathname === "/" ? "" : pathname}`;
    url.search = "";
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("content-security-policy");
    requestHeaders.delete("x-nonce");
    requestHeaders.set("x-request-id", requestId);
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildContentSecurityPolicy({ nonce, isDevelopment });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  if (request.headers.has(INTERNAL_RENDER_HEADER)) {
    // Internal render for the document cache: render without a nonce. Strip any
    // client-supplied CSP/nonce so the cached HTML never echoes one.
    requestHeaders.delete("content-security-policy");
    requestHeaders.delete("x-nonce");
  } else {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }

  const response = rewriteTarget
    ? NextResponse.rewrite(rewriteTarget, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  // Anything not served from the document cache gets the per-request nonce
  // CSP; a raw internal render therefore cannot execute scripts in a browser.
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  const effectivePath = rewriteTarget?.pathname ?? pathname;
  if (request.headers.has(INTERNAL_RENDER_HEADER)) response.headers.set(INTERNAL_RENDER_MARKER, "1");
  if (PORTAL_HOSTS.has(host) || isPrivatePath(effectivePath) || request.headers.has(INTERNAL_RENDER_HEADER)) {
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  }

  return response;
}

export const config = {
  matcher:
    "/((?!_next/static|_next/image|assets|favicon.ico|manifest.webmanifest|149e9513-01fa-4fb0-aad4-566afd725d1b/).*)",
};
