import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), eval: vi.fn(), verify: vi.fn() }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => mocks }));
vi.mock("argon2", () => ({ default: { verify: mocks.verify } }));
import { migrateLegacyPasskeys } from "../security-console/lib/legacy-passkeys";
const credential = { id: "existing-key", publicKey: "AQID", counter: 7, name: "Established key", deviceType: "singleDevice", backedUp: false, transports: ["internal"] };
const prefix = "speedzone:security-console:";
let store: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks(); store = { [`${prefix}passkeys`]: [credential], [`${prefix}password`]: "legacy-hash", [`${prefix}credential-epoch`]: "3" };
  mocks.get.mockImplementation(async key => store[key] ?? null); mocks.verify.mockResolvedValue(true);
});
it("preserves existing public key, ID, counter and transports after matching password verification", async () => {
  await migrateLegacyPasskeys("Synthetic!42", 3, "verified-current-hash");
  expect(mocks.verify).toHaveBeenCalledWith("legacy-hash", "Synthetic!42");
  const args = mocks.eval.mock.calls[0]?.[2];
  expect(JSON.parse(args[4])).toEqual([{ ...credential, credentialEpoch: 3 }]);
  expect(args.slice(1, 4)).toEqual(["3", "verified-current-hash", "legacy-hash"]);
});
it.each([{ current: [] }, { current: [{ ...credential, credentialEpoch: 3 }] }])("never overwrites an authoritative versioned store (%j)", async ({ current }) => {
  store[`${prefix}passkeys:v1`] = current;
  await migrateLegacyPasskeys("Synthetic!42", 3, "current-hash");
  expect(mocks.eval).not.toHaveBeenCalled();
});
it("does not resurrect credentials from an older epoch", async () => {
  await migrateLegacyPasskeys("Synthetic!42", 4, "current-hash");
  expect(mocks.eval).not.toHaveBeenCalled();
});
it("does not import passkeys if the old password does not match", async () => {
  mocks.verify.mockResolvedValue(false);
  await migrateLegacyPasskeys("Synthetic!42", 3, "current-hash");
  expect(mocks.eval).not.toHaveBeenCalled();
});
it("refuses malformed legacy credentials", async () => {
  store[`${prefix}passkeys`] = [{ ...credential, counter: -1 }];
  await migrateLegacyPasskeys("Synthetic!42", 3, "current-hash");
  expect(mocks.eval).not.toHaveBeenCalled();
});
