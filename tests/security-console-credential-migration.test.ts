import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  eval: vi.fn(),
  verify: vi.fn(),
  hash: vi.fn(),
}));

vi.mock("../security-console/lib/redis", () => ({
  getSecurityRedis: () => ({ get: mocks.get, eval: mocks.eval }),
}));

vi.mock("argon2", () => ({
  default: { argon2id: 2, verify: mocks.verify, hash: mocks.hash },
}));

import { isPasswordConfigured, verifyPassword } from "../security-console/lib/password";

beforeEach(() => vi.resetAllMocks());

it("recognizes the established legacy security-console password", async () => {
  mocks.get.mockImplementation(async (key: string) => key === "speedzone:security-console:password" ? "legacy-hash" : key === "speedzone:security-console:credential-epoch" ? "3" : null);
  expect(await isPasswordConfigured()).toBe(true);
});

it("upgrades a verified legacy password into the versioned credential record", async () => {
  mocks.get.mockImplementation(async (key: string) => key === "speedzone:security-console:password" ? "legacy-hash" : key === "speedzone:security-console:credential-epoch" ? "3" : null);
  mocks.verify.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("upgraded-hash");
  mocks.eval.mockResolvedValue(3);

  await expect(verifyPassword("EstablishedPassword!42")).resolves.toEqual({ ok: true, epoch: 3, migrated: true });
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), [
    "speedzone:security-console:credential:v1",
    "speedzone:security-console:credential-epoch:v1",
    "speedzone:security-console:password",
    "speedzone:security-console:credential-epoch",
  ], ["legacy-hash", "upgraded-hash", "3"]);
});

it.each(["credential:v1", "credential-epoch:v1"])("fails closed on partial versioned %s state", async suffix => {
  mocks.get.mockImplementation(async (key: string) => key === `speedzone:security-console:${suffix}` ? (suffix === "credential:v1" ? "current-hash" : "4") : key.endsWith(":password") ? "legacy-hash" : key.endsWith(":credential-epoch") ? "3" : null);
  await expect(verifyPassword("EstablishedPassword!42")).resolves.toEqual({ ok: false, reason: "unavailable" });
  expect(mocks.eval).not.toHaveBeenCalled();
});

it("does not migrate a legacy credential when password verification fails", async () => {
  mocks.get.mockImplementation(async (key: string) => key === "speedzone:security-console:password" ? "legacy-hash" : key === "speedzone:security-console:credential-epoch" ? "1" : null);
  mocks.verify.mockResolvedValue(false);

  await expect(verifyPassword("WrongPassword!42")).resolves.toEqual({ ok: false, reason: "invalid" });
  expect(mocks.eval).not.toHaveBeenCalled();
});
