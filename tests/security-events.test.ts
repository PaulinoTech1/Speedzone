import { describe, expect, it } from "vitest";
import { canonical, createSecurityEvent, requestId, sanitizeMetadata, verifySecurityEvent } from "@/lib/security-events";

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
});
