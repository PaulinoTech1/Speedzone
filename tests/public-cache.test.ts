import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as cdnDocument } from "@/app/cdn-document/[[...path]]/route";
import {
  buildContentSecurityPolicy,
  cacheTagsFor,
  inlineContentHashes,
  INTERNAL_RENDER_HEADER,
  isPublicDocumentPath,
  PUBLIC_API_PATHS,
  shouldServeCachedDocument,
} from "@/lib/public-cache";
import { renderOrigin } from "@/lib/render-origin";
import { proxy } from "@/proxy";

const PUBLIC_PAGES = ["/", "/inventory", "/inventory/abc-123", "/test-drive", "/sell-your-car", "/buying-costs", "/recall-check", "/road-trip", "/privacy", "/terms", "/report-a-problem"];

function rewriteTarget(response: Response) {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
}

function directives(csp: string) {
  return Object.fromEntries(csp.split("; ").map(part => { const [name, ...values] = part.split(" "); return [name!, values]; }));
}

/** Every App Router route under a directory, as URL paths with sample params. */
function appRoutes(directory: string): string[] {
  const root = join(process.cwd(), "src/app");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/^(route|page)\.tsx?$/.test(entry)) {
        routes.push("/" + relative(root, dir).split("/").filter(part => !/^\(.*\)$/.test(part)).map(part => part.startsWith("[") ? "sample-id" : part).join("/"));
      }
    }
  };
  walk(join(root, directory));
  return routes;
}

describe("route classification", () => {
  it("treats only anonymous read-only pages as public documents", () => {
    for (const path of PUBLIC_PAGES) expect(isPublicDocumentPath(path), path).toBe(true);
    for (const path of ["/admin", "/admin/inventory", "/api/inventory", "/inventory/bad%20id", "/inventory/a/b", "/cdn-document", "/sitemap.xml", "/unknown"]) {
      expect(isPublicDocumentPath(path), path).toBe(false);
    }
  });

  it("serves only plain GET/HEAD navigations from the document cache", () => {
    const base = { pathname: "/inventory", isPortalHost: false };
    expect(shouldServeCachedDocument({ ...base, method: "GET", headers: new Headers() })).toBe(true);
    expect(shouldServeCachedDocument({ ...base, method: "HEAD", headers: new Headers() })).toBe(true);
    expect(shouldServeCachedDocument({ ...base, method: "POST", headers: new Headers() })).toBe(false);
    for (const header of ["rsc", "next-router-prefetch", "next-action", "next-router-state-tree", INTERNAL_RENDER_HEADER]) {
      expect(shouldServeCachedDocument({ ...base, method: "GET", headers: new Headers({ [header]: "1" }) }), header).toBe(false);
    }
    expect(shouldServeCachedDocument({ ...base, method: "GET", headers: new Headers(), isPortalHost: true })).toBe(false);
  });

  it("tags inventory pages for on-demand invalidation", () => {
    expect(cacheTagsFor("/inventory")).toContain("sz-inventory");
    expect(cacheTagsFor("/")).toContain("sz-inventory");
    expect(cacheTagsFor("/inventory/abc-123")).toEqual(expect.arrayContaining(["sz-inventory", "sz-vehicle:abc-123"]));
    expect(cacheTagsFor("/privacy")).not.toContain("sz-inventory");
  });
});

describe("content security policy", () => {
  it("nonce policy for dynamic routes is strict", () => {
    const d = directives(buildContentSecurityPolicy({ nonce: "abc" }));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("hash policy for cached documents has no unsafe-inline or nonce and keeps every directive", () => {
    const csp = buildContentSecurityPolicy({ scriptHashes: ["'sha256-AAA='"], styleHashes: ["'sha256-BBB='"] });
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("nonce-");
    const d = directives(csp);
    expect(d["script-src"]).toEqual(["'self'", "'sha256-AAA='"]);
    expect(d["style-src"]).toEqual(["'self'", "'sha256-BBB='"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'", "https://vercel.com"]);
    expect(Object.keys(d)).toContain("upgrade-insecure-requests");
    expect(Object.keys(directives(buildContentSecurityPolicy({ nonce: "x" }))).sort()).toEqual(Object.keys(d).sort());
  });

  it("hashes executable inline scripts and styles only", async () => {
    const html = `<script src="/a.js" async=""></script><script>self.__next_f.push([0])</script><script type="application/ld+json">{"a":1}</script><script type="module">x()</script><style>p{}</style>`;
    const { createHash } = await import("node:crypto");
    const sha = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
    const hashes = await inlineContentHashes(html);
    expect(hashes.scripts).toEqual([sha("self.__next_f.push([0])"), sha("x()")]);
    expect(hashes.styles).toEqual([sha("p{}")]);
  });

  it("ends scripts where browsers do, including end tags with whitespace or attributes", async () => {
    const { createHash } = await import("node:crypto");
    const sha = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
    const hashes = await inlineContentHashes("<script>a()</script\t\n bar><script>b()</SCRIPT ><script>c()</scriptx></script>");
    expect(hashes.scripts).toEqual([sha("a()"), sha("b()"), sha("c()</scriptx>")]);
  });
});

describe("proxy cache and CSP selection", () => {
  it("rewrites public page navigations to the cached document handler without a nonce", () => {
    for (const path of PUBLIC_PAGES) {
      const response = proxy(new NextRequest(`https://www.speedzonems.com${path}?utm=1`));
      expect(rewriteTarget(response), path).toBe(`/cdn-document${path === "/" ? "" : path}`);
      expect(response.headers.get("Content-Security-Policy"), path).toBeNull();
      expect(response.headers.get("x-middleware-request-x-nonce"), path).toBeNull();
    }
  });

  it("keeps RSC requests for public pages dynamic with a nonce CSP", () => {
    const response = proxy(new NextRequest("https://www.speedzonems.com/inventory", { headers: { rsc: "1" } }));
    expect(rewriteTarget(response)).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toMatch(/script-src 'self' 'nonce-[0-9a-f]{32}' 'strict-dynamic'/);
  });

  it("renders internal document requests without a nonce and never caches them", () => {
    const response = proxy(new NextRequest("https://www.speedzonems.com/inventory", { headers: { [INTERNAL_RENDER_HEADER]: "1", "x-nonce": "attacker", "content-security-policy": "script-src 'nonce-attacker'" } }));
    expect(rewriteTarget(response)).toBeNull();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBeNull();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("blocks direct requests to the internal document handler", () => {
    const response = proxy(new NextRequest("https://www.speedzonems.com/cdn-document/inventory"));
    expect(response.status).toBe(404);
  });

  it("never gives admin pages or API routes public caching", () => {
    const apiRoutes = appRoutes("api");
    const adminRoutes = appRoutes("admin");
    expect(apiRoutes.length).toBeGreaterThan(10);
    expect(adminRoutes).toContain("/admin");
    const requests: Array<[string, string, string]> = [
      ...apiRoutes.flatMap(path => ["GET", "POST", "PATCH", "DELETE"].map(method => ["www.speedzonems.com", path, method] as [string, string, string])),
      ...adminRoutes.map(path => ["admin-inventory.speedzonems.com", path.replace(/^\/admin/, "") || "/", "GET"] as [string, string, string]),
      ...adminRoutes.map(path => ["admin-inventory.speedzonems.com", path, "GET"] as [string, string, string]),
      ["admin-inventory.speedzonems.com", "/inventory", "GET"],
    ];
    for (const [host, path, method] of requests) {
      if (PUBLIC_API_PATHS.has(path)) continue;
      const response = proxy(new NextRequest(`https://${host}${path}`, { method, headers: { host } }));
      const label = `${method} ${host}${path}`;
      expect(rewriteTarget(response)?.startsWith("/cdn-document") ?? false, label).toBe(false);
      if (response.status === 404) continue;
      expect(response.headers.get("Cache-Control"), label).toMatch(/no-store/);
      expect(response.headers.get("Cache-Control"), label).not.toMatch(/public|s-maxage/);
      expect(response.headers.get("Content-Security-Policy"), label).toMatch(/'nonce-/);
    }
  });
});

describe("API route sources", () => {
  it("never declare a public or shared-cache Cache-Control (except the public photo proxy)", async () => {
    const { readFileSync } = await import("node:fs");
    const root = join(process.cwd(), "src/app/api");
    const files: string[] = [];
    const walk = (dir: string) => { for (const entry of readdirSync(dir)) { const path = join(dir, entry); if (statSync(path).isDirectory()) walk(path); else if (/^route\.tsx?$/.test(entry)) files.push(path); } };
    walk(root);
    for (const file of files) {
      const route = "/api/" + relative(root, file).replace(/\/route\.tsx?$/, "");
      if (PUBLIC_API_PATHS.has(route)) continue;
      expect(readFileSync(file, "utf8"), route).not.toMatch(/public,\s*(max-age|s-maxage)|s-maxage|stale-while-revalidate/i);
    }
  });
});

describe("cached document handler", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const call = (path: string[], headers: Record<string, string> = { host: "localhost:4183" }) =>
    cdnDocument(new Request(`http://localhost:4183/cdn-document/${path.join("/")}`, { headers }), { params: Promise.resolve({ path }) });

  it("returns the rendered page with matching hashes and public CDN caching", async () => {
    const html = "<html><body><script>self.__next_f.push([1,\"x\"])</script></body></html>";
    const fetchMock = vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await call(["inventory", "abc-123"], { host: "localhost:4183", cookie: "admin_session=secret; _vercel_jwt=jwt1", "x-nonce": "n" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-Cache-Tag")).toContain("sz-inventory");
    const { scripts } = await inlineContentHashes(html);
    expect(response.headers.get("Content-Security-Policy")).toContain(`script-src 'self' ${scripts[0]}`);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://localhost:4183/inventory/abc-123");
    const sent = new Headers(init.headers);
    expect(sent.get(INTERNAL_RENDER_HEADER)).toBe("1");
    expect(sent.get("cookie")).toBe("_vercel_jwt=jwt1");
    expect(sent.get("x-nonce")).toBeNull();
  });

  it("does not cache redirects, errors or non-HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 307, headers: { location: "/x" } })));
    expect((await call(["privacy"])).headers.get("Cache-Control")).toContain("no-store");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500, headers: { "content-type": "text/html" } })));
    expect((await call(["privacy"])).headers.get("Cache-Control")).toContain("no-store");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
    expect((await call(["privacy"])).headers.get("Cache-Control")).toContain("no-store");
  });

  it("refuses non-public paths and untrusted hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(["admin"])).status).toBe(404);
    expect((await call(["inventory"], { host: "evil.example" })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("render origin", () => {
  it("only trusts this site and this deployment on Vercel", () => {
    const env = { VERCEL: "1", VERCEL_URL: "sz-abc.vercel.app" } as unknown as NodeJS.ProcessEnv;
    expect(renderOrigin("www.speedzonems.com", env)).toBe("https://www.speedzonems.com");
    expect(renderOrigin("sz-abc.vercel.app", env)).toBe("https://sz-abc.vercel.app");
    expect(renderOrigin("evil.vercel.app", env)).toBeNull();
    expect(renderOrigin("localhost:3000", env)).toBeNull();
    expect(renderOrigin("localhost:4183", {} as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:4183");
  });
});
