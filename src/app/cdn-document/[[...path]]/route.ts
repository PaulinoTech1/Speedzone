import {
  buildContentSecurityPolicy,
  cacheTagsFor,
  inlineContentHashes,
  INTERNAL_RENDER_HEADER,
  INTERNAL_RENDER_MARKER,
  isPublicDocumentPath,
  NO_STORE_CACHE_CONTROL,
  PUBLIC_DOCUMENT_CACHE_CONTROL,
  PUBLIC_NOT_FOUND_CACHE_CONTROL,
} from "@/lib/public-cache";
import { renderOrigin } from "@/lib/render-origin";

// Reached only through the proxy rewrite of a public page navigation. It
// renders the page once, hashes that document's inline scripts into a strict
// CSP, and returns body + CSP together so the CDN caches a matching pair.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

const FORWARDED_PROTECTION_HEADERS = ["x-vercel-protection-bypass", "x-vercel-trusted-oidc-idp-token"];

function notCacheable(status: number, body?: string, extra: Record<string, string> = {}) {
  return new Response(body ?? null, { status, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL, ...extra } });
}

export async function GET(request: Request, { params }: Context) {
  const segments = (await params).path ?? [];
  const pathname = `/${segments.map(encodeURIComponent).join("/")}`;
  if (!isPublicDocumentPath(pathname)) return notCacheable(404, "Not Found");

  const origin = renderOrigin(request.headers.get("host"));
  if (!origin) return notCacheable(404, "Not Found");

  // Only Vercel's deployment-protection credentials are forwarded so previews
  // can render; visitor cookies and headers never reach the cached render.
  const headers = new Headers({ [INTERNAL_RENDER_HEADER]: "1", accept: "text/html" });
  for (const name of FORWARDED_PROTECTION_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const jwt = /(?:^|;\s*)_vercel_jwt=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  if (jwt) headers.set("cookie", `_vercel_jwt=${jwt}`);

  let upstream: Response;
  try {
    upstream = await fetch(new URL(pathname, origin), { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    return notCacheable(503, "Service Unavailable", { "Retry-After": "30" });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    return notCacheable(upstream.status, undefined, location ? { Location: location } : {});
  }
  // Anything not rendered by this app's proxy (a deployment-protection or
  // login page, an error page) is never cached.
  if ((upstream.status !== 200 && upstream.status !== 404) || !contentType.startsWith("text/html") || upstream.headers.get(INTERNAL_RENDER_MARKER) !== "1") {
    return notCacheable(upstream.status === 200 ? 502 : upstream.status, "Unable to render page");
  }

  const html = await upstream.text();
  const hashes = await inlineContentHashes(html);
  const csp = buildContentSecurityPolicy({ scriptHashes: hashes.scripts, styleHashes: hashes.styles });
  return new Response(html, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Content-Security-Policy": csp,
      "Cache-Control": upstream.status === 200 ? PUBLIC_DOCUMENT_CACHE_CONTROL : PUBLIC_NOT_FOUND_CACHE_CONTROL,
      "Vercel-Cache-Tag": cacheTagsFor(pathname).join(","),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
