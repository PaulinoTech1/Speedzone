import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => mocks }));
import { passkeyRecoveryAvailable, recoveryCodeMatches, recoveryGrant } from "../security-console/lib/passkey-recovery";
const code = "R".repeat(43);
const sha256 = createHash("sha256").update(code).digest("hex");
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SECURITY_PASSKEY_RECOVERY", ""); });
afterEach(() => vi.unstubAllEnvs());
it.each(["", "null", "not-json", JSON.stringify({ sha256, expiresAt: 1 }), JSON.stringify({ sha256, expiresAt: Date.now() + 172_800_000 }), JSON.stringify({ sha256: "wrong", expiresAt: Date.now() + 60_000 })])("disables recovery for invalid or expired configuration (%s)", async configuration => {
  vi.stubEnv("SECURITY_PASSKEY_RECOVERY", configuration);
  expect(recoveryGrant()).toBeNull(); expect(await passkeyRecoveryAvailable()).toBe(false);
  expect(mocks.get).not.toHaveBeenCalled();
});
it("requires the separate recovery secret and closes after consumption", async () => {
  vi.stubEnv("SECURITY_PASSKEY_RECOVERY", JSON.stringify({ sha256, expiresAt: Date.now() + 60_000 }));
  expect(recoveryCodeMatches(code, sha256)).toBe(true);
  expect(recoveryCodeMatches("S".repeat(43), sha256)).toBe(false);
  expect(recoveryCodeMatches({}, sha256)).toBe(false);
  mocks.get.mockResolvedValue(null); expect(await passkeyRecoveryAvailable()).toBe(true);
  mocks.get.mockResolvedValue("used"); expect(await passkeyRecoveryAvailable()).toBe(false);
  mocks.get.mockRejectedValue(new Error("Unavailable")); expect(await passkeyRecoveryAvailable()).toBe(false);
});
