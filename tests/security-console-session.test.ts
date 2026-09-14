import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eval: vi.fn(), cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => ({ eval: mocks.eval }) }));

import { SECURITY_COOKIE, securityCookieOptions, validateSecuritySession } from "../security-console/lib/auth";
import { consolePath } from "../security-console/lib/paths";

beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("rejects the inventory-admin cookie before reading console sessions", async () => {
  const request = new Request("https://www.speedzonems.com/Security_Console", { headers: { cookie: `speedzone_admin=${"a".repeat(43)}` } });
  expect(await validateSecuritySession(request)).toBe(false);
  expect(mocks.eval).not.toHaveBeenCalled();
  expect(mocks.cookie).toHaveBeenCalledWith(SECURITY_COOKIE);
});

it("validates the console cookie against the independent store with MFA required", async () => {
  mocks.eval.mockResolvedValue(1);
  const request = new Request("https://www.speedzonems.com/Security_Console", { headers: { cookie: `${SECURITY_COOKIE}=${"b".repeat(43)}` } });
  expect(await validateSecuritySession(request)).toBe(true);
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), [
    expect.stringMatching(/^speedzone:security-console:session:v1:/),
    "speedzone:security-console:session-generation:v1",
    "speedzone:security-console:credential-epoch:v1",
  ], [expect.any(Number), 14_400_000, 900_000, "mfa"]);
});

it("keeps the console cookie host-only, secure, HTTP-only and distinct", () => {
  expect(SECURITY_COOKIE).toBe("__Host-speedzone_security");
  expect(securityCookieOptions).toMatchObject({ secure: true, httpOnly: true, sameSite: "strict", path: "/" });
  expect(securityCookieOptions).not.toHaveProperty("domain");
});

it("keeps mounted navigation and APIs under the console path", () => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "/Security_Console");
  expect(consolePath("/")).toBe("/Security_Console");
  expect(consolePath("/login/passkey")).toBe("/Security_Console/login/passkey");
  expect(consolePath("/api/auth/login")).toBe("/Security_Console/api/auth/login");
});

it("retains root paths in the standalone build", () => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "");
  expect(consolePath("/")).toBe("/");
  expect(consolePath("/login")).toBe("/login");
});
