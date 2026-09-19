import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), eval: vi.fn(), verify: vi.fn(), options: vi.fn(), session: vi.fn() }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => mocks }));
vi.mock("../security-console/lib/password", () => ({ currentCredentialEpoch: async () => 3 }));
vi.mock("../security-console/lib/auth", () => ({ validateSecuritySession: mocks.session }));
vi.mock("@simplewebauthn/server", () => ({ generateAuthenticationOptions: mocks.options, verifyAuthenticationResponse: mocks.verify,
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn() }));
import { authenticationOptions, establishedPasskeyCount, verifyAuthentication, registrationOptions, verifyRegistration } from "../security-console/lib/passkeys";
const config = { rpID: "www.speedzonems.com", origins: ["https://www.speedzonems.com"] };
const origin = "https://www.speedzonems.com";
const key = { id: "established-key", publicKey: "AQID", counter: 7, credentialEpoch: 3, transports: ["internal"] };
const assertion = { id: key.id, response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: "one-use-challenge" })).toString("base64url") } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async name => name.endsWith("passkeys:v1") ? [key] : { challenge: "one-use-challenge", credentialEpoch: 3, createdAt: Date.now(), origin });
  mocks.options.mockResolvedValue({ challenge: "one-use-challenge" });
  mocks.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 8 } }); mocks.eval.mockResolvedValue(1);
});
it("offers the established passkey with user verification required", async () => {
  await authenticationOptions(config, origin);
  expect(mocks.options).toHaveBeenCalledWith({ rpID: config.rpID, allowCredentials: [{ id: key.id, transports: key.transports }], userVerification: "required" });
});
it("binds assertion verification to the expected origin, RP, stored key and counter", async () => {
  expect(await verifyAuthentication(assertion, config)).toEqual({ verified: true, credentialEpoch: 3 });
  expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ expectedOrigin: origin, expectedRPID: config.rpID, expectedChallenge: "one-use-challenge", requireUserVerification: true,
    credential: expect.objectContaining({ id: key.id, counter: 7 }) }));
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), expect.any(Array), ["3", "one-use-challenge", key.id, "7", "8"]);
});
it("rejects an invalid assertion without consuming or upgrading anything", async () => {
  mocks.verify.mockResolvedValue({ verified: false });
  expect(await verifyAuthentication(assertion, config)).toHaveProperty("error");
  expect(mocks.eval).not.toHaveBeenCalled();
});
it("does not fall back to enrollment when established credentials are unavailable", async () => {
  mocks.get.mockResolvedValue([]);
  expect(await authenticationOptions(config, origin)).toHaveProperty("error");
  expect(mocks.options).not.toHaveBeenCalled();
});
it("password-only sessions cannot enroll or verify a new registration", async () => {
  mocks.session.mockResolvedValue(false);
  expect(await registrationOptions(config, origin)).toHaveProperty("error");
  expect(await verifyRegistration({}, "Replacement", config)).toHaveProperty("error");
  expect(mocks.eval).not.toHaveBeenCalled();
});
it.each([undefined, 2])("accepts established credentials with schema marker %s", async schema => {
  mocks.get.mockImplementation(async name => name.endsWith("passkeys:v1") ? [{ ...key, schema }] : { challenge: "one-use-challenge", credentialEpoch: 3, createdAt: Date.now(), origin });
  expect(await establishedPasskeyCount()).toBe(1);
  expect(await authenticationOptions(config, origin)).toHaveProperty("options");
  expect(await verifyAuthentication(assertion, config)).toEqual({ verified: true, credentialEpoch: 3 });
});
it.each([{ malformed: true }, [key, { malformed: true }], false])("fails closed on malformed storage (%j)", async store => {
  mocks.get.mockResolvedValue(store);
  expect(await establishedPasskeyCount()).toBeNull();
  expect(await authenticationOptions(config, origin)).toMatchObject({ status: 503 });
  expect(await verifyAuthentication(assertion, config)).toHaveProperty("error");
  expect(mocks.options).not.toHaveBeenCalled();
  expect(mocks.eval).not.toHaveBeenCalled();
});
it("preserves supported transports when an MFA user adds a passkey", async () => {
  const { generateRegistrationOptions, verifyRegistrationResponse } = await import("@simplewebauthn/server");
  mocks.session.mockResolvedValue(true);
  vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: "one-use-challenge" } as never);
  expect(await registrationOptions(config, origin)).toHaveProperty("options");
  expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({ excludeCredentials: [{ id: key.id, transports: key.transports }] }));
  vi.mocked(verifyRegistrationResponse).mockResolvedValue({ verified: true, registrationInfo: {
    credential: { id: "new-key", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal", "usb", "future-transport"] },
    credentialDeviceType: "singleDevice", credentialBackedUp: false,
  } } as never);
  expect(await verifyRegistration(assertion, "Backup", config)).toEqual({ verified: true, credentialEpoch: 3 });
  expect(mocks.eval).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(mocks.eval.mock.calls[0]![2][2]);
  expect(stored).toMatchObject({ id: "new-key", transports: ["internal", "usb"], credentialEpoch: 3 });
});
