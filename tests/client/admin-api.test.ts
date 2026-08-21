import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminFetch,
  clearClientSecurityState,
  rememberCsrfToken,
} from "@/lib/client/admin-api";

afterEach(() => {
  clearClientSecurityState();
  vi.unstubAllGlobals();
});

describe("admin API CSRF renewal", () => {
  it("refreshes an expired token and retries a rejected mutation exactly once", async () => {
    rememberCsrfToken("stale-token");
    const requests: Array<{ path: string; token: string | null; body: BodyInit | null | undefined }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ path, token: headers.get("x-csrf-token"), body: init?.body });
      if (requests.length === 1) {
        return Response.json(
          { ok: false, error: { code: "REQUEST_REJECTED", message: "Request rejected" } },
          { status: 403 },
        );
      }
      if (path === "/api/admin/csrf") {
        return Response.json({ ok: true, csrfToken: "fresh-token" });
      }
      return Response.json({ ok: true, saved: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      adminFetch<{ ok: true; saved: true }>("/api/admin/inventory", {
        method: "POST",
        json: { stockNumber: "SZ-1" },
      }),
    ).resolves.toEqual({ ok: true, saved: true });

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({ path: "/api/admin/inventory", token: "stale-token" });
    expect(requests[1]).toMatchObject({ path: "/api/admin/csrf", token: null });
    expect(requests[2]).toMatchObject({ path: "/api/admin/inventory", token: "fresh-token" });
    expect(requests[2]?.body).toBe(requests[0]?.body);
  });
});
