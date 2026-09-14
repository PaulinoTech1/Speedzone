import { describe, expect, it } from "vitest";
import { canonical, createSecurityEvent, requestId, sanitizeMetadata, securityClientContext, userAgentFamily, verifySecurityEvent } from "@/lib/security-events";

describe("security events", () => {
  it("rejects prohibited fields and preserves bounded safe metadata", () => {
    expect(sanitizeMetadata({ password: "secret", email: "customer@example.com", count: 2, ok: true })).toEqual({ count: 2, ok: true });
  });
  it("creates and verifies deterministic hashes", () => {
    const event = createSecurityEvent({ requestId: "req_test_123", event: "admin.login", outcome: "denied", actor: "anonymous", route: "/api/admin/login", method: "POST" });
    expect(verifySecurityEvent(event)).toBe(true);
    expect(verifySecurityEvent({ ...event, reason: "tampered" })).toBe(false);
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("accepts safe request IDs and replaces unsafe input", () => {
    expect(requestId("req_valid_123")).toBe("req_valid_123");
    expect(requestId("secret token")).toMatch(/^req_/);
  });
  it("creates a privacy-safe client context without retaining the IP address", () => {
    process.env.VERCEL = "1";
    process.env.SECURITY_IP_HASH_SECRET = "a-secure-test-key-that-is-at-least-32-bytes";
    const request = new Request("https://example.test/api/admin/login", { headers: { "x-forwarded-for": "203.0.113.10", "x-vercel-ip-country": "us", "x-vercel-ip-country-region": "ny", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" } });
    const context = securityClientContext(request);
    expect(context).toMatchObject({ country: "US", region: "ny", userAgentFamily: "Chrome / Windows" });
    expect(context?.networkFingerprint).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(context)).not.toContain("203.0.113.10");
    delete process.env.VERCEL;
    delete process.env.SECURITY_IP_HASH_SECRET;
  });
  it("reduces user agents to a bounded family", () => {
    expect(userAgentFamily("Mozilla/5.0 (Macintosh) Version/17 Safari/605.1")).toBe("Safari / macOS");
  });
});
