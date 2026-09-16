import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), count: vi.fn(), recovery: vi.fn(), bootstrap: vi.fn() }));
vi.mock("../security-console/lib/passkey-recovery", () => ({ passkeyRecoveryAvailable: mocks.recovery }));
vi.mock("../security-console/lib/guards", () => ({ requirePasswordSession: mocks.guard }));
vi.mock("../security-console/lib/passkeys", async importOriginal => ({ ...await importOriginal<object>(), establishedPasskeyCount: mocks.count, firstPasskeyAvailable: mocks.bootstrap }));
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
  expect(html).not.toContain("Register first security passkey");
  expect(html).not.toContain("Replace unavailable passkeys");
});
it.each([0, 2])("offers authorized recovery even when an unusable established key is present (%s)", async count => {
  mocks.count.mockResolvedValue(count); mocks.recovery.mockResolvedValue(true);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("One-time recovery code");
  expect(html).toContain("Register recovery passkey");
});
it("does not offer recovery against unavailable credential storage", async () => {
  mocks.count.mockResolvedValue(null); mocks.recovery.mockResolvedValue(true);
  expect(renderToStaticMarkup(await Page())).not.toContain("Register recovery passkey");
});
it("offers first-passkey setup after password login when both stores are empty", async () => {
  mocks.count.mockResolvedValue(0); mocks.bootstrap.mockResolvedValue(true);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Register first security passkey");
  expect(html).not.toContain("Console access is locked");
  expect(html).not.toContain("One-time recovery code");
});
it("requires recovery when inactive or legacy keys prevent first-time setup", async () => {
  mocks.count.mockResolvedValue(0); const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain("Use security passkey");
  expect(html).not.toContain("Register first security passkey");
  expect(html).toContain("Console access is locked until credential recovery is performed.");
});
it("locks access when passkey storage is unavailable", async () => {
  mocks.count.mockResolvedValue(null); const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain("Use security passkey");
  expect(html).not.toContain("Register first security passkey");
  expect(html).toContain("storage is unavailable");
});
