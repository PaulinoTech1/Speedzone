import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ events: vi.fn(), guard: vi.fn() }));
vi.mock("../security-console/lib/guards", () => ({ requireMfa: mocks.guard }));
vi.mock("../security-console/lib/security-store", async importOriginal => ({ ...await importOriginal<object>(), readEvents: mocks.events }));
vi.mock("../security-console/lib/console-audit", () => ({ readConsoleAudit: async () => [] }));
vi.mock("../security-console/lib/auth", () => ({ listSecuritySessions: async () => [] }));
vi.mock("../security-console/lib/auth-health", () => ({ authenticationHealth: async () => ({}) }));
import Page from "../security-console/app/page";
beforeEach(() => vi.resetAllMocks());
it("does not present provider failure as zero logins or an empty audit history", async () => {
  mocks.events.mockRejectedValue(new Error("Query unavailable"));
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Login counts and activity are unavailable, not zero");
  expect(html).toContain('class="value">Unavailable');
  expect(html).not.toContain('class="value">0');
  expect(html).not.toContain("No administrator access events are available.");
});
it("shows zero when the provider successfully returns no events", async () => {
  mocks.events.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('class="value">0');
  expect(html).toContain("No administrator access events are available.");
});
it("requires MFA before reading website audit events", async () => {
  mocks.guard.mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.events).not.toHaveBeenCalled();
});
