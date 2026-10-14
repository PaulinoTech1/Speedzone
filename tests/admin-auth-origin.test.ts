import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/admin-login-rate-limit", () => ({ checkAdminLoginRateLimit: mocks.limit }));
vi.mock("@/lib/admin-recovery", () => ({ verifyAdminPassword: mocks.verify, createRecoveryToken: vi.fn(), resetAdminPasswordWithToken: vi.fn(), recoveryConfigured: () => true, recoveryEmail: "owner@example.com", recoveryTtlSeconds: 900 }));
vi.mock("@/lib/admin-passkeys", () => ({ hasCurrentPasskey: vi.fn() }));
vi.mock("@/lib/diagnostics", () => ({ withDiagnostics: (_op: string, fn: () => Promise<Response>) => fn() }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: async () => {}, auditRoute: async (_r: Request, _e: string, f: () => Promise<Response>) => f() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
import { POST as login } from "@/app/api/admin/login/route";
import { POST as recovery } from "@/app/api/admin/recovery/route";
import { POST as reset } from "@/app/api/admin/recovery/reset/route";

const admin = "https://admin-inventory.speedzonems.com";
function post(path: string, headers: Record<string, string>) {
  return new Request(`${admin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ password: "x".repeat(16), email: "owner@example.com" }) });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("WEBAUTHN_ORIGIN", admin); mocks.limit.mockResolvedValue({ configured: true, success: true, retryAfter: 0 }); });

it.each([["/api/admin/login", login], ["/api/admin/recovery", recovery], ["/api/admin/recovery/reset", reset]] as const)("%s rejects foreign Origin and cross-site Fetch Metadata before any work", async (path, handler) => {
  const variants: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: "https://www.speedzonems.com" }, { origin: admin, "sec-fetch-site": "cross-site" }, { origin: admin, "sec-fetch-site": "same-site" }];
  for (const headers of variants) {
    const response = await handler(post(path, headers));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
});
it("same-origin admin login proceeds to password verification", async () => {
  mocks.verify.mockResolvedValue({ verified: false, reason: "invalid" });
  const response = await login(post("/api/admin/login", { origin: admin, "sec-fetch-site": "same-origin" }));
  expect(response.status).toBe(401); expect(mocks.verify).toHaveBeenCalledOnce();
});
