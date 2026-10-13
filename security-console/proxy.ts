import { NextRequest, NextResponse } from "next/server";
import { SECURITY_COOKIE } from "@/lib/auth";

// Standalone deployment: per-request nonce CSP (no 'unsafe-inline' scripts),
// matching the primary site's approach. Pages render dynamically so Next can
// attach the nonce to its own scripts.
export function contentSecurityPolicy(nonce: string, development = process.env.NODE_ENV === "development") {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const path=request.nextUrl.pathname;
  const publicPath=path==="/login"||path==="/setup"||path.startsWith("/api/auth/")||path.startsWith("/_next/")||path==="/favicon.ico";
  if(!publicPath&&!request.cookies.has(SECURITY_COOKIE)) return NextResponse.redirect(new URL("/login",request.url));
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config={matcher:["/((?!_next/static|_next/image).*)"]};
