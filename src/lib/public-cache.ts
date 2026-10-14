import { vehicleIdPattern } from "@/lib/vehicle-details";

/**
 * CDN caching and Content-Security-Policy selection.
 *
 * Next.js only attaches a CSP nonce to its inline flight scripts
 * (`self.__next_f.push`) during a per-request render, and experimental SRI
 * does not cover inline scripts. Public HTML is therefore rendered once per
 * CDN cache entry by an internal request, and /cdn-document hashes that exact
 * document's inline scripts into a CSP that is cached together with the body.
 * Everything else keeps the per-request nonce CSP and is never publicly cached.
 */

export const INTERNAL_RENDER_HEADER = "x-speedzone-document-render";
/** Set by the proxy on internal render responses; proves the HTML is ours (not e.g. a Vercel login page). */
export const INTERNAL_RENDER_MARKER = "x-speedzone-rendered";
export const CDN_DOCUMENT_PREFIX = "/cdn-document";

/** Short CDN TTL with stale-while-revalidate. Browsers always revalidate. */
export const PUBLIC_DOCUMENT_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
export const PUBLIC_NOT_FOUND_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const NO_STORE_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

export const PUBLIC_CACHE_TAG = "sz-public";
export const INVENTORY_CACHE_TAG = "sz-inventory";

const STATIC_PUBLIC_PAGES = new Set([
  "/",
  "/inventory",
  "/test-drive",
  "/sell-your-car",
  "/buying-costs",
  "/recall-check",
  "/road-trip",
  "/privacy",
  "/terms",
  "/report-a-problem",
]);

const INVENTORY_PAGES = new Set(["/", "/inventory"]);

function vehicleIdFromPath(pathname: string): string | null {
  const match = /^\/inventory\/([^/]+)$/.exec(pathname);
  return match && vehicleIdPattern.test(match[1]!) ? match[1]! : null;
}

/** Read-only, anonymous pages whose HTML is identical for every visitor. */
export function isPublicDocumentPath(pathname: string): boolean {
  return STATIC_PUBLIC_PAGES.has(pathname) || vehicleIdFromPath(pathname) !== null;
}

/**
 * The one public API: the inventory photo proxy streams already-public listing
 * photos (no cookies, no auth) and keeps its existing public image caching.
 */
export const PUBLIC_API_PATHS = new Set(["/api/inventory/image"]);

/** Paths that must never receive a public Cache-Control. */
export function isPrivatePath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  return lower === "/admin" || lower.startsWith("/admin/") || lower === "/api" || lower.startsWith("/api/");
}

export type DocumentRequestShape = { method: string; pathname: string; headers: Headers; isPortalHost: boolean };

/**
 * Only plain anonymous navigations are served from the CDN document cache.
 * RSC/prefetch/server-action requests and anything carrying credentials other
 * than Vercel's own deployment-protection cookie stay on the dynamic path.
 */
export function shouldServeCachedDocument({ method, pathname, headers, isPortalHost }: DocumentRequestShape): boolean {
  if (isPortalHost) return false;
  if (method !== "GET" && method !== "HEAD") return false;
  if (!isPublicDocumentPath(pathname)) return false;
  if (headers.has("rsc") || headers.has("next-router-prefetch") || headers.has("next-action") || headers.has("next-router-state-tree")) return false;
  if (headers.has(INTERNAL_RENDER_HEADER)) return false;
  return true;
}

export function cacheTagsFor(pathname: string): string[] {
  const tags = [PUBLIC_CACHE_TAG, `sz-page:${pathname}`];
  const vehicleId = vehicleIdFromPath(pathname);
  if (INVENTORY_PAGES.has(pathname) || vehicleId) tags.push(INVENTORY_CACHE_TAG);
  if (vehicleId) tags.push(`sz-vehicle:${vehicleId}`);
  return tags;
}

type CspOptions = {
  isDevelopment?: boolean;
  /** Per-request nonce (dynamic routes). */
  nonce?: string;
  /** CSP source expressions such as 'sha256-...' (cached public documents). */
  scriptHashes?: string[];
  styleHashes?: string[];
};

export function buildContentSecurityPolicy({ isDevelopment = false, nonce, scriptHashes = [], styleHashes = [] }: CspOptions): string {
  const scriptSources = ["'self'"];
  const styleSources = ["'self'"];
  if (nonce) {
    scriptSources.push(`'nonce-${nonce}'`, "'strict-dynamic'");
    styleSources.push(`'nonce-${nonce}'`);
  } else {
    // Hash-only policy: no 'strict-dynamic', so same-origin bundles are
    // allowed by 'self' and every inline script must match a listed hash.
    scriptSources.push(...scriptHashes);
    styleSources.push(...styleHashes);
  }
  if (isDevelopment) scriptSources.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    isDevelopment ? "style-src 'self' 'unsafe-inline'" : `style-src ${styleSources.join(" ")}`,
    `script-src ${scriptSources.join(" ")}`,
    "connect-src 'self' https://vercel.com",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const EXECUTABLE_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?`, "i").exec(attributes);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

async function sha256Source(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return `'sha256-${Buffer.from(digest).toString("base64")}'`;
}

/** Hashes of every executable inline <script> and every <style> in the document. */
export async function inlineContentHashes(html: string): Promise<{ scripts: string[]; styles: string[] }> {
  const scripts = new Set<string>();
  const styles = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script(?=[\s/>])[^>]*>/gi)) {
    const attributes = match[1] ?? "";
    if (attribute(attributes, "src") !== null) continue;
    const type = (attribute(attributes, "type") ?? "").trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue; // e.g. application/ld+json is data, not script
    scripts.add(await sha256Source(match[2] ?? ""));
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style(?=[\s/>])[^>]*>/gi)) {
    styles.add(await sha256Source(match[1] ?? ""));
  }
  return { scripts: [...scripts], styles: [...styles] };
}
