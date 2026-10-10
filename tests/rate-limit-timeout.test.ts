import { afterEach, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ evalsha: vi.fn(() => new Promise(() => {})), eval: vi.fn(() => new Promise(() => {})) }));
vi.mock("@upstash/redis", () => ({ Redis: class { evalsha = redis.evalsha; eval = redis.eval; } }));
vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });
it("fails closed in both application limiters when the real library times out", async () => {
  vi.useFakeTimers();
  vi.stubEnv("KV_REST_API_URL", "https://synthetic.invalid"); vi.stubEnv("KV_REST_API_TOKEN", "SYNTHETIC");
  const { checkAdminLoginRateLimit } = await import("@/lib/admin-login-rate-limit");
  const { limitTestDriveSubmission } = await import("@/lib/test-drive-rate-limit");
  const admin = checkAdminLoginRateLimit("synthetic");
  const form = limitTestDriveSubmission({ ip: "synthetic", contact: "synthetic" });
  await vi.advanceTimersByTimeAsync(2001);
  expect(await admin).toMatchObject({ success: false, configured: false });
  expect(await form).toMatchObject({ success: false, configured: false });
});
