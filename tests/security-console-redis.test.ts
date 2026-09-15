import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { constructor(options: unknown) { mocks.constructed(options); } } }));
import { getSecurityRedis, resetSecurityRedisForTests, securityRedisConfiguration } from "../security-console/lib/redis";
import { POST as login } from "../src/app/Security_Console/api/auth/login/route";
const names = ["ADMIN_SECURITY_KV_REST_API_URL", "ADMIN_SECURITY_KV_REST_API_TOKEN", "SECURITY_KV_REST_API_URL", "SECURITY_KV_REST_API_TOKEN", "ADMIN_SECURITY_KV_REST_API_READ_ONLY_TOKEN", "ADMIN_SECURITY_KV_URL", "ADMIN_SECURITY_REDIS_URL"];
beforeEach(() => { vi.clearAllMocks(); resetSecurityRedisForTests(); names.forEach(name => vi.stubEnv(name, "")); });
afterEach(() => vi.unstubAllEnvs());
it.each(["URL", "TOKEN"])("rejects partial dedicated %s even with a complete legacy pair", async part => {
  vi.stubEnv(`ADMIN_SECURITY_KV_REST_API_${part}`, "dedicated-value");
  vi.stubEnv("SECURITY_KV_REST_API_URL", "https://legacy.example"); vi.stubEnv("SECURITY_KV_REST_API_TOKEN", "legacy-token");
  expect(securityRedisConfiguration().status).toBe("INVALID_PAIR");
  expect(getSecurityRedis()).toBeNull(); expect(mocks.constructed).not.toHaveBeenCalled();
  const response = await login(new Request("https://www.speedzonems.com/Security_Console/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "SyntheticTestPassword!42" }) }));
  expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocks.constructed).not.toHaveBeenCalled();
});
it("uses only the complete dedicated pair", () => {
  vi.stubEnv("ADMIN_SECURITY_KV_REST_API_URL", "https://dedicated.example"); vi.stubEnv("ADMIN_SECURITY_KV_REST_API_TOKEN", "dedicated-token");
  vi.stubEnv("SECURITY_KV_REST_API_URL", "https://legacy.example"); vi.stubEnv("SECURITY_KV_REST_API_TOKEN", "legacy-token");
  getSecurityRedis(); expect(mocks.constructed).toHaveBeenCalledWith({ url: "https://dedicated.example", token: "dedicated-token" });
});
it("supports the complete legacy pair only when dedicated configuration is absent", () => {
  vi.stubEnv("SECURITY_KV_REST_API_URL", "https://legacy.example"); vi.stubEnv("SECURITY_KV_REST_API_TOKEN", "legacy-token");
  getSecurityRedis(); expect(mocks.constructed).toHaveBeenCalledWith({ url: "https://legacy.example", token: "legacy-token" });
});
it("never substitutes provider URLs or the read-only token", () => {
  names.slice(4).forEach(name => vi.stubEnv(name, "provider-created-value"));
  expect(getSecurityRedis()).toBeNull(); expect(securityRedisConfiguration().status).toBe("MISSING");
});
