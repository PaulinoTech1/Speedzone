import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), session: vi.fn(), revoke: vi.fn() }));
vi.mock("../security-console/lib/password", () => ({ verifyPassword: mocks.verify }));
vi.mock("../security-console/lib/auth", () => ({
  createSecuritySession: mocks.session,
  revokeSecuritySession: mocks.revoke,
  SECURITY_COOKIE: "__Host-speedzone_security",
  securityCookieOptions: { httpOnly: true, secure: true, sameSite: "strict", path: "/" },
  privateHeaders: { "Cache-Control": "private, no-store" },
}));
vi.mock("../security-console/lib/rate-limit", () => ({ enforceRateLimit: async () => ({ allowed: true }) }));
vi.mock("../security-console/lib/console-audit", () => ({ recordConsoleAudit: vi.fn() }));

import { POST } from "../src/app/Security_Console/api/auth/login/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "/Security_Console");
});

function request() {
  return new Request("https://www.speedzonems.com/Security_Console/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "SyntheticTestPassword!42" }),
  });
}

it("always routes a verified password to passkey verification, revoking any prior session", async () => {
  mocks.verify.mockResolvedValue({ ok: true, epoch: 3 });
  mocks.session.mockResolvedValue("s".repeat(43));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, next: "/Security_Console/login/passkey" });
  expect(mocks.revoke).toHaveBeenCalledOnce();
  expect(mocks.session).toHaveBeenCalledWith(3, "password");
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("__Host-speedzone_security=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).not.toContain("speedzone_admin=");
});

it("does not issue any session for an invalid console password", async () => {
  mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocks.session).not.toHaveBeenCalled();
});
