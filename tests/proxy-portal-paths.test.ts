import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

describe("proxy portal path gating", () => {
  it("returns 404 for portal paths on the main domain", () => {
    for (const [host, path] of [
      ["www.speedzonems.com", "/admin"],
      ["www.speedzonems.com", "/admin/inventory"],
      ["www.speedzonems.com", "/Security_Console/login"],
      ["speedzonems.com", "/admin"],
    ] as Array<[string, string]>) {
      const response = proxy(
        new NextRequest(`https://${host}${path}`, { headers: { host } }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("serves portal paths on their dedicated subdomains", () => {
    const rewrite = vi.spyOn(NextResponse, "rewrite");
    const subdomainRequest = (host: string, path: string) =>
      new NextRequest(`https://${host}${path}`, { headers: { host } });
    try {
      proxy(subdomainRequest("admin-inventory.speedzonems.com", "/"));
      proxy(subdomainRequest("www.admin-inventory.speedzonems.com", "/reports"));
      proxy(subdomainRequest("security-console.speedzonems.com", "/"));
      proxy(subdomainRequest("www.security-console.speedzonems.com", "/"));
      expect(rewrite).toHaveBeenCalledTimes(4);
      const pathnames = rewrite.mock.calls.map((call) => new URL(call[0] as URL).pathname);
      const [first, second, third, fourth] = pathnames;
      expect(first?.startsWith("/admin")).toBe(true);
      expect(second).toBe("/admin/reports");
      expect(third?.startsWith("/Security_Console")).toBe(true);
      expect(fourth?.startsWith("/Security_Console")).toBe(true);
    } finally {
      rewrite.mockRestore();
    }
  });

  it("does not mistake sibling paths for portal paths", () => {
    // /api/* and non-portal pages pass through the normal proxy on every host.
    const api = proxy(new NextRequest("https://www.speedzonems.com/api/admin/test-drives"));
    expect(api.status).toBe(200);
    expect(api.headers.get("Content-Security-Policy")).not.toBeNull();

    const home = proxy(new NextRequest("https://www.speedzonems.com/"));
    expect(home.status).toBe(200);
  });
});
