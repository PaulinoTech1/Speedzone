import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => mocks, securityRedisConfiguration: () => ({ status: "SET", source: "ADMIN_SECURITY" }) }));
import { authenticationHealth } from "../security-console/lib/auth-health";
beforeEach(() => vi.resetAllMocks());
it("exposes only counts and presence, never stored credential material", async () => {
  mocks.get.mockImplementation(async key => key.endsWith("passkeys:v1") ? [{ credentialEpoch: 3, publicKey: "secret-key" }, { credentialEpoch: 2 }] : key.endsWith("credential-epoch:v1") ? "3" : "secret-value");
  const health = await authenticationHealth();
  expect(health).toMatchObject({ redis: "CONNECTED", currentEpoch: 3, activePasskeys: 1, credential: "PRESENT" });
  expect(JSON.stringify(health)).not.toContain("secret");
});
it("does not disclose provider exception messages", async () => {
  mocks.get.mockRejectedValue(new Error("secret-token-and-url"));
  expect(await authenticationHealth()).toEqual({ redis: "UNAVAILABLE", configuration: "SET", source: "ADMIN_SECURITY" });
});
