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
      expect(rewrite).toHaveBeenCalledTimes(2);
      const pathnames = rewrite.mock.calls.map((call) => new URL(call[0] as URL).pathname);
      const [first, second] = pathnames;
      expect(first?.startsWith("/admin")).toBe(true);
      expect(second).toBe("/admin/reports");
    } finally {
      rewrite.mockRestore();
    }
  });

  it("returns 404 for the retired console mount and subdomain on every host", () => {
    const rewrite = vi.spyOn(NextResponse, "rewrite");
    try {
      for (const [host, path] of [
        ["www.speedzonems.com", "/Security_Console"],
        ["www.speedzonems.com", "/Security_Console/login"],
        ["www.speedzonems.com", "/security_console/api/events"],
        ["speedzone-five.vercel.app", "/Security_Console/passkeys"],
        ["security-console.speedzonems.com", "/"],
        ["security-console.speedzonems.com", "/login"],
        ["www.security-console.speedzonems.com", "/api/auth/login"],
        ["security-console.speedzonems.com", "/Security_Console"],
      ] as Array<[string, string]>) {
        const response = proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
        expect(response.status, `${host}${path}`).toBe(404);
        expect(response.headers.get("location")).toBeNull();
      }
      expect(rewrite).not.toHaveBeenCalled();
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
