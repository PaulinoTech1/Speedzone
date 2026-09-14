import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), upgrade: vi.fn(), verify: vi.fn(), register: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../security-console/lib/auth", () => ({ validateSecuritySession: mocks.validate, upgradeSecuritySession: mocks.upgrade,
  SECURITY_COOKIE: "__Host-speedzone_security", securityCookieOptions: { secure: true, httpOnly: true, sameSite: "strict", path: "/" }, privateHeaders: { "Cache-Control": "private, no-store" } }));
vi.mock("../security-console/lib/rate-limit", () => ({ enforceRateLimit: async () => ({ allowed: true }) }));
vi.mock("../security-console/lib/console-audit", () => ({ recordConsoleAudit: vi.fn() }));
vi.mock("../security-console/lib/passkeys", () => ({ getWebAuthnConfig: () => ({ rpID: "www.speedzonems.com", origin: "https://www.speedzonems.com" }),
  verifyAuthentication: mocks.verify, verifyRegistration: mocks.register, registrationOptions: vi.fn(), authenticationOptions: vi.fn(), deletePasskey: vi.fn(), listPasskeys: vi.fn() }));
import { POST } from "../src/app/Security_Console/api/auth/passkeys/route";
beforeEach(() => vi.resetAllMocks());
function request(action: string) { return new Request("https://www.speedzonems.com/Security_Console/api/auth/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, response: {} }) }); }

it.each(["register", "registration-options"])("password-only sessions cannot use %s", async action => {
  mocks.validate.mockImplementation(async (_request, level) => level === "password");
  const response = await POST(request(action));
  expect(response.status).toBe(401);
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.upgrade).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBeNull();
});
it.each([{ error: "Invalid assertion" }, { verified: false, credentialEpoch: 3 }])("failed assertions never issue MFA sessions (%j)", async result => {
  mocks.validate.mockResolvedValue(true); mocks.verify.mockResolvedValue(result);
  expect((await POST(request("authenticate"))).status).toBe(401);
  expect(mocks.upgrade).not.toHaveBeenCalled();
});
it("only a verified assertion elevates the matching epoch", async () => {
  mocks.validate.mockResolvedValue(true); mocks.verify.mockResolvedValue({ verified: true, credentialEpoch: 3 }); mocks.upgrade.mockResolvedValue("s".repeat(43));
  const response = await POST(request("authenticate"));
  expect(response.status).toBe(200);
  expect(mocks.upgrade).toHaveBeenCalledWith(expect.any(Request), 3);
  expect(response.headers.get("set-cookie")).toContain("__Host-speedzone_security=");
});
it("revoked or expired sessions cannot be elevated even after a valid assertion", async () => {
  mocks.validate.mockResolvedValue(true); mocks.verify.mockResolvedValue({ verified: true, credentialEpoch: 3 }); mocks.upgrade.mockResolvedValue(null);
  const response = await POST(request("authenticate"));
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
});
it("adding a passkey from an MFA session never creates a new MFA session", async () => {
  mocks.validate.mockResolvedValue(true); mocks.register.mockResolvedValue({ verified: true, credentialEpoch: 3 });
  const response = await POST(request("register"));
  expect(response.status).toBe(200);
  expect(mocks.upgrade).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBeNull();
});
