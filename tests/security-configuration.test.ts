import { describe, expect, it } from "vitest";
import { missingSecurityConfiguration } from "../scripts/check-security-config.mjs";

function configured(): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries([
    "WEBAUTHN_RP_ID", "BLOB_READ_WRITE_TOKEN", "TEST_DRIVE_BLOB_READ_WRITE_TOKEN", "RESEND_PASSWORD_RESET_API_KEY", "RESEND_EMAIL_DOMAIN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  ].map(key => [key, "synthetic"]));
  return { ...env, WEBAUTHN_ORIGIN: "https://admin.example.test", BUG_REPORT_ORIGIN: "https://www.example.test", ADMIN_RECOVERY_EMAIL: "owner@example.test", TEST_DRIVE_ENCRYPTION_KEY: "a".repeat(43), BUG_REPORT_ENCRYPTION_KEY: "b".repeat(43), BUG_REPORT_RATE_LIMIT_SECRET: "c".repeat(43), SECURITY_CONSOLE_TEST_SECRET: "d".repeat(43), SECURITY_TEST_TARGET_URL: "https://www.example.test/api/internal/security-log-test" };
}
describe("production security configuration", () => {
  it("requires an explicit owner mailbox", () => {
    const env = configured(); delete env.ADMIN_RECOVERY_EMAIL;
    expect(missingSecurityConfiguration(env)).toContain("ADMIN_RECOVERY_EMAIL");
  });
  it("rejects malformed keys, credential-bearing origins, and short test secrets", () => {
    const env = { ...configured(), BUG_REPORT_ENCRYPTION_KEY: "weak", BUG_REPORT_ORIGIN: "https://user:password@www.example.test", SECURITY_CONSOLE_TEST_SECRET: "weak" };
    expect(missingSecurityConfiguration(env)).toEqual(expect.arrayContaining(["BUG_REPORT_ENCRYPTION_KEY: invalid key format", "BUG_REPORT_ORIGIN: invalid origin", "SECURITY_CONSOLE_TEST_SECRET: must contain at least 32 characters"]));
  });
  it("accepts either complete supported Redis credential pair", () => {
    const env: Record<string, string> = configured();
    expect(missingSecurityConfiguration(env)).toEqual([]);
    env.UPSTASH_REDIS_REST_URL = env.KV_REST_API_URL!; env.UPSTASH_REDIS_REST_TOKEN = env.KV_REST_API_TOKEN!;
    delete env.KV_REST_API_URL; delete env.KV_REST_API_TOKEN;
    expect(missingSecurityConfiguration(env)).toEqual([]);
    delete env.UPSTASH_REDIS_REST_TOKEN;
    expect(missingSecurityConfiguration(env)).toContain("UPSTASH_REDIS_REST_TOKEN");
  });
});
