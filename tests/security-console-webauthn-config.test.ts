import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getWebAuthnConfig } from "../security-console/lib/passkeys";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "/Security_Console");
  vi.stubEnv("SECURITY_WEBAUTHN_ORIGIN", "https://logs.speedzonems.com");
  vi.stubEnv("SECURITY_WEBAUTHN_RP_ID", "logs.speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", "");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGINS", "");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

it("uses the embedded request host instead of inheriting the legacy console origin", () => {
  expect(getWebAuthnConfig(new Headers({ host: "www.speedzonems.com" }))).toEqual({
    origins: ["https://www.speedzonems.com"], rpID: "www.speedzonems.com",
  });
});
it("honors explicit embedded settings behind a deployment proxy", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", " https://www.speedzonems.com ");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", " www.speedzonems.com ");
  expect(getWebAuthnConfig(new Headers({ host: "deployment.vercel.app" }))).toEqual({
    origins: ["https://www.speedzonems.com"], rpID: "www.speedzonems.com",
  });
});
it("parses a comma-separated origin allowlist for apex and www", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGINS", "https://www.speedzonems.com, https://speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "speedzonems.com");
  expect(getWebAuthnConfig(new Headers({ host: "deployment.vercel.app" }))).toEqual({
    origins: ["https://www.speedzonems.com", "https://speedzonems.com"], rpID: "speedzonems.com",
  });
});
it("prefers the plural origins variable over the legacy singular one", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGINS", "https://speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", "https://www.speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "speedzonems.com");
  expect(getWebAuthnConfig(new Headers())).toEqual({
    origins: ["https://speedzonems.com"], rpID: "speedzonems.com",
  });
});
it("rejects an origin that does not belong to the RP ID", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGINS", "https://evil.example.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "speedzonems.com");
  expect(() => getWebAuthnConfig(new Headers())).toThrow(/not valid for RP ID/);
});
it("rejects a non-https origin", () => {
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGINS", "http://speedzonems.com");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "speedzonems.com");
  expect(() => getWebAuthnConfig(new Headers())).toThrow(/not valid for RP ID/);
});
it("preserves the standalone console configuration", () => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "");
  expect(getWebAuthnConfig(new Headers({ host: "www.speedzonems.com" }))).toEqual({
    origins: ["https://logs.speedzonems.com"], rpID: "logs.speedzonems.com",
  });
});
it("supports local embedded setup without production origins", () => {
  expect(getWebAuthnConfig(new Headers({ host: "localhost:4173" }))).toEqual({
    origins: ["http://localhost:4173"], rpID: "localhost",
  });
});
