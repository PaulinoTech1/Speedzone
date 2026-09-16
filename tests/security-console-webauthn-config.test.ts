import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getWebAuthnConfig } from "../security-console/lib/passkeys";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "/Security_Console");
  vi.stubEnv("SECURITY_WEBAUTHN_ORIGIN", "https://logs.speedzonems.com");
  vi.stubEnv("SECURITY_WEBAUTHN_RP_ID", "logs.speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", "");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

it("uses the embedded request host instead of inheriting the legacy console origin", () => {
  expect(getWebAuthnConfig(new Headers({ host: "www.speedzonems.com" }))).toEqual({
    origin: "https://www.speedzonems.com", rpID: "www.speedzonems.com",
  });
});
it("honors explicit embedded settings behind a deployment proxy", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", " https://www.speedzonems.com ");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", " www.speedzonems.com ");
  expect(getWebAuthnConfig(new Headers({ host: "deployment.vercel.app" }))).toEqual({
    origin: "https://www.speedzonems.com", rpID: "www.speedzonems.com",
  });
});
it("preserves the standalone console configuration", () => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "");
  expect(getWebAuthnConfig(new Headers({ host: "www.speedzonems.com" }))).toEqual({
    origin: "https://logs.speedzonems.com", rpID: "logs.speedzonems.com",
  });
});
it("supports local embedded setup without production origins", () => {
  expect(getWebAuthnConfig(new Headers({ host: "localhost:4173" }))).toEqual({
    origin: "http://localhost:4173", rpID: "localhost",
  });
});
