import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isDevelopment = process.env.NODE_ENV === "development";
  const isAdmin = request.nextUrl.pathname.startsWith("/admin");
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    isDevelopment
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isAdmin ? " 'wasm-unsafe-eval'" : ""}${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self' https://*.blob.vercel-storage.com",
    "media-src 'none'",
    isAdmin ? "worker-src 'self' blob:" : "worker-src 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (isAdmin) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

export const config = {
  matcher:
    "/((?!api|_next/static|_next/image|assets|favicon.ico|manifest.webmanifest).*)",
};
