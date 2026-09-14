import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), events: vi.fn() }));
vi.mock("../security-console/lib/guards", () => ({ requireMfa: mocks.guard }));
vi.mock("../security-console/lib/security-store", () => ({ readEvents: mocks.events }));
vi.mock("../security-console/lib/console-audit", () => ({ readConsoleAudit: async () => [] }));
vi.mock("../security-console/lib/auth", () => ({ listSecuritySessions: async () => [] }));
import Dashboard from "../src/app/Security_Console/page";
beforeEach(() => { vi.resetAllMocks(); mocks.events.mockResolvedValue([]); });
it("never loads dashboard data when the MFA guard rejects the session", async () => {
  mocks.guard.mockRejectedValue(new Error("Passkey required"));
  await expect(Dashboard()).rejects.toThrow("Passkey required");
  expect(mocks.events).not.toHaveBeenCalled();
});
it("renders the dashboard after the MFA guard accepts the session", async () => {
  const html = renderToStaticMarkup(await Dashboard());
  expect(mocks.guard).toHaveBeenCalledOnce();
  expect(html).toContain("Security headquarters");
  expect(html).toContain("Overview");
  expect(html).toContain("Admin access");
});
