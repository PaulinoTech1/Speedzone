import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), count: vi.fn() }));
vi.mock("../security-console/lib/guards", () => ({ requirePasswordSession: mocks.guard }));
vi.mock("../security-console/lib/passkeys", async importOriginal => ({ ...await importOriginal<object>(), establishedPasskeyCount: mocks.count }));
import Page from "../src/app/Security_Console/login/passkey/page";
beforeEach(() => vi.resetAllMocks());
it("loads established-key counts only after password authorization", async () => {
  mocks.guard.mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT"); expect(mocks.count).not.toHaveBeenCalled();
});
it("shows the established count without credential material", async () => {
  mocks.count.mockResolvedValue(2); const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Password verified. Security passkey required.");
  expect(html).toContain("Established security passkeys: 2"); expect(html).toContain("Use security passkey");
});
it.each([0, null])("locks access when established passkeys are unavailable (%s)", async count => {
  mocks.count.mockResolvedValue(count); const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain("Use security passkey");
  expect(html).toContain(count === 0 ? "Console access is locked until credential recovery is performed." : "storage is unavailable");
});
