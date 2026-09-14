import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), eval: vi.fn(), verify: vi.fn(), options: vi.fn(), session: vi.fn() }));
vi.mock("../security-console/lib/redis", () => ({ getSecurityRedis: () => mocks }));
vi.mock("../security-console/lib/password", () => ({ currentCredentialEpoch: async () => 3 }));
vi.mock("../security-console/lib/auth", () => ({ validateSecuritySession: mocks.session }));
vi.mock("@simplewebauthn/server", () => ({ generateAuthenticationOptions: mocks.options, verifyAuthenticationResponse: mocks.verify,
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn() }));
import { authenticationOptions, verifyAuthentication, registrationOptions, verifyRegistration } from "../security-console/lib/passkeys";
const config = { rpID: "www.speedzonems.com", origin: "https://www.speedzonems.com" };
const key = { id: "established-key", publicKey: "AQID", counter: 7, credentialEpoch: 3, transports: ["internal"] };
const assertion = { id: key.id, response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: "one-use-challenge" })).toString("base64url") } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async name => name.endsWith("passkeys:v1") ? [key] : { challenge: "one-use-challenge", credentialEpoch: 3, createdAt: Date.now() });
  mocks.options.mockResolvedValue({ challenge: "one-use-challenge" });
  mocks.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 8 } }); mocks.eval.mockResolvedValue(1);
});
it("offers the established passkey with user verification required", async () => {
  await authenticationOptions(config);
  expect(mocks.options).toHaveBeenCalledWith({ rpID: config.rpID, allowCredentials: [{ id: key.id, transports: key.transports }], userVerification: "required" });
});
it("binds assertion verification to the expected origin, RP, stored key and counter", async () => {
  expect(await verifyAuthentication(assertion, config)).toEqual({ verified: true, credentialEpoch: 3 });
  expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ expectedOrigin: config.origin, expectedRPID: config.rpID, expectedChallenge: "one-use-challenge", requireUserVerification: true,
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
  expect(await authenticationOptions(config)).toHaveProperty("error");
  expect(mocks.options).not.toHaveBeenCalled();
});
it("password-only sessions cannot enroll or verify a new registration", async () => {
  mocks.session.mockResolvedValue(false);
  expect(await registrationOptions(config)).toHaveProperty("error");
  expect(await verifyRegistration({}, "Replacement", config)).toHaveProperty("error");
  expect(mocks.eval).not.toHaveBeenCalled();
});
