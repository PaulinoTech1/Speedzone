import { expect, it } from "vitest";
import { dashboardSummary } from "../security-console/lib/dashboard";
import type { SecurityEvent } from "../security-console/lib/security-store";
const event = (overrides: Partial<SecurityEvent> = {}): SecurityEvent => ({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), occurredAt: new Date().toISOString(), event: "admin.session.created", outcome: "allowed", actor: "admin", route: "/api/admin/login", hash: "", ...overrides });
it("counts completed password and passkey sessions once, excluding verification and synthetic events", () => {
  const password = event({ requestId: "password-request" });
  const passkey = event({ requestId: "passkey-request", route: "/api/admin/passkey" });
  expect(dashboardSummary([password, password, passkey, event({ event: "admin.login" }), event({ event: "admin.passkey", reason: "authentication-options" }), event({ metadata: { synthetic: true } }), event({ occurredAt: "2020-01-01T00:00:00Z" })]).successfulLogins).toBe(2);
});
it("includes passkey authentication failures without counting enrollment or options errors", () => {
  expect(dashboardSummary([event({ event: "admin.login", outcome: "denied" }), event({ event: "admin.passkey", reason: "authenticate", outcome: "denied" }), event({ event: "admin.passkey", reason: "register", outcome: "denied" })]).failedLogins).toBe(2);
});
