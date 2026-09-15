import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import argon2 from "argon2";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: {} as Record<string,string>, cookie: "", changeLegacyEpoch: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }), headers: async () => new Headers({ host: "www.speedzonems.com" }) }));
vi.mock("../security-console/lib/redis", () => ({
  securityRedisConfiguration: () => ({ status: "SET", source: "ADMIN_SECURITY" }),
  getSecurityRedis: () => ({
    get: async (key: string) => { const raw = state.store[key]; if (raw === undefined) return null; try { return JSON.parse(raw); } catch { return raw; } },
    set: async (key: string, value: unknown, options?: { nx?: boolean }) => { if (options?.nx && key in state.store) return null; state.store[key] = typeof value === "string" ? value : JSON.stringify(value); return "OK"; },
    del: async (key: string) => { delete state.store[key]; return 1; },
    incr: async () => 1, expire: async () => 1, zrange: async () => [], lrange: async () => [],
    eval: async (script: string, keys: string[], args: unknown[]) => {
      if (state.changeLegacyEpoch && keys[0] === "speedzone:security-console:credential:v1") state.store["speedzone:security-console:credential-epoch"] = "4";
      const output = execFileSync("python", [resolve("tests/helpers/security-lua.py")], {
        input: JSON.stringify({ script, keys, args, store: state.store }), encoding: "utf8",
      });
      const result = JSON.parse(output); state.store = result.store; return result.result;
    },
  }),
}));
vi.mock("../security-console/lib/security-store", () => ({ readEvents: async () => [] }));
import { POST as login } from "../src/app/Security_Console/api/auth/login/route";
import { POST as passkey, GET as listPasskeys } from "../src/app/Security_Console/api/auth/passkeys/route";
import { GET as events } from "../src/app/Security_Console/api/events/route";
import Dashboard from "../src/app/Security_Console/page";
import PasskeysPage from "../src/app/Security_Console/passkeys/page";
import IntegrityPage from "../src/app/Security_Console/integrity/page";
import ReportsPage from "../src/app/Security_Console/reports/page";
import { SECURITY_COOKIE, validateSecuritySession } from "../security-console/lib/auth";
const prefix = "speedzone:security-console:";
const password = "SyntheticIntegrationPassword!42";
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = keys.publicKey.export({ format: "jwk" });
// COSE EC2, ES256, P-256, x and y coordinates from a synthetic test key.
const cose = Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]), Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22,0x58,0x20]), Buffer.from(jwk.y!, "base64url")]);
const credential = { id: Buffer.from("synthetic-established-key").toString("base64url"), publicKey: cose.toString("base64url"), counter: 7, credentialEpoch: 3, deviceType: "singleDevice", backedUp: false, name: "Synthetic established key" };
function request(path: string, body?: unknown) { return new Request(`https://www.speedzonems.com/Security_Console${path}`, { method: body ? "POST" : "GET", headers: { cookie: `${SECURITY_COOKIE}=${state.cookie}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
function sessionKey() { return `${prefix}session:v1:${createHash("sha256").update(state.cookie).digest("hex")}`; }
async function passwordLogin() { const response = await login(request("/api/auth/login", { password })); expect(response.status).toBe(200); state.cookie = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!; return response; }
async function assertion() {
  const optionsResponse = await passkey(request("/api/auth/passkeys", { action: "authentication-options" }));
  expect(optionsResponse.status).toBe(200);
  const { options } = await optionsResponse.json();
  expect(options.allowCredentials.map((item: {id:string}) => item.id)).toEqual([credential.id]);
  expect(options.userVerification).toBe("required");
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: "https://www.speedzonems.com", crossOrigin: false }));
  const counter = Buffer.alloc(4); counter.writeUInt32BE(8);
  const authenticatorData = Buffer.concat([createHash("sha256").update("www.speedzonems.com").digest(), Buffer.from([5]), counter]);
  const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]), keys.privateKey);
  return { id: credential.id, rawId: credential.id, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"), signature: signature.toString("base64url") } };
}
beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH", "/Security_Console");
  vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_RP_ID", "www.speedzonems.com"); vi.stubEnv("EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", "https://www.speedzonems.com");
  state.cookie = ""; state.changeLegacyEpoch = false; state.store = { [`${prefix}credential:v1`]: await argon2.hash(password), [`${prefix}credential-epoch:v1`]: "3", [`${prefix}passkeys:v1`]: JSON.stringify([credential]) };
});
function legacyState() {
  state.store[`${prefix}password`] = state.store[`${prefix}credential:v1`]!;
  state.store[`${prefix}credential-epoch`] = "3";
  const legacy = { ...credential } as Partial<typeof credential>; delete legacy.credentialEpoch;
  state.store[`${prefix}passkeys`] = JSON.stringify([legacy]);
  delete state.store[`${prefix}credential:v1`]; delete state.store[`${prefix}credential-epoch:v1`]; delete state.store[`${prefix}passkeys:v1`];
}
it("atomically preserves established legacy credentials without duplication", async () => {
  legacyState(); const original = state.store[`${prefix}passkeys`];
  await passwordLogin(); await passwordLogin();
  expect(state.store[`${prefix}passkeys`]).toBe(original);
  expect(JSON.parse(state.store[`${prefix}passkeys:v1`]!)).toEqual([credential]);
  const response = await assertion();
  expect((await passkey(request("/api/auth/passkeys", { action: "authenticate", response }))).status).toBe(200);
  expect(state.store[`${prefix}passkeys`]).toBe(original);
});
it("refuses password migration when the legacy epoch changes during verification", async () => {
  legacyState(); state.changeLegacyEpoch = true;
  const response = await login(request("/api/auth/login", { password }));
  expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toBeNull();
  expect(state.store[`${prefix}credential:v1`]).toBeUndefined(); expect(state.store[`${prefix}credential-epoch:v1`]).toBeUndefined();
});
it.each(["established", "empty", "missing", "malformed"])("rejects bootstrap without changing credentials or granting MFA (%s)", async condition => {
  await passwordLogin();
  if (condition === "empty") state.store[`${prefix}passkeys:v1`] = "[]";
  if (condition === "missing") delete state.store[`${prefix}passkeys:v1`];
  if (condition === "malformed") state.store[`${prefix}passkeys:v1`] = JSON.stringify({ malformed: true });
  state.store[`${prefix}passkeys`] = JSON.stringify([credential]);
  const original = state.store[`${prefix}passkeys:v1`];
  const legacy = state.store[`${prefix}passkeys`];
  for (const action of ["bootstrap-options", "bootstrap", "replacement-options", "replace"]) {
    const response = await passkey(request("/api/auth/passkeys", { action, response: {} }));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect(state.store[`${prefix}passkeys:v1`]).toBe(original);
  expect(state.store[`${prefix}passkeys`]).toBe(legacy);
  expect(JSON.parse(state.store[sessionKey()]!).level).toBe("password");
  expect(await validateSecuritySession()).toBe(false);
  await expect(Dashboard()).rejects.toThrow("NEXT_REDIRECT");
});
it("denies anonymous and password-only protected pages and privileged APIs", async () => {
  await expect(Dashboard()).rejects.toThrow("NEXT_REDIRECT");
  await passwordLogin(); expect(JSON.parse(state.store[sessionKey()]!).level).toBe("password");
  for (const page of [Dashboard, PasskeysPage, IntegrityPage]) await expect(page()).rejects.toThrow("NEXT_REDIRECT");
  await expect(ReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  expect((await events(request("/api/events"))).status).toBe(401);
  expect((await listPasskeys(request("/api/auth/passkeys"))).status).toBe(401);
  for (const action of ["registration-options", "register"]) expect((await passkey(request("/api/auth/passkeys", { action }))).status).toBe(401);
});
it("fails closed without active keys and with a cryptographically invalid assertion", async () => {
  await passwordLogin(); const validAssertion = await assertion();
  validAssertion.response.signature = Buffer.from("invalid-signature").toString("base64url");
  expect((await passkey(request("/api/auth/passkeys", { action: "authenticate", response: validAssertion }))).status).toBe(401);
  expect(await validateSecuritySession()).toBe(false);
  state.store[`${prefix}passkeys:v1`] = "[]";
  expect((await passkey(request("/api/auth/passkeys", { action: "authentication-options" }))).status).toBe(403);
  await expect(Dashboard()).rejects.toThrow("NEXT_REDIRECT");
});
it("verifies a real signed assertion, rotates the password session, renders the dashboard, and rejects replay", async () => {
  await passwordLogin(); const oldToken = state.cookie; const oldKey = sessionKey(); const response = await assertion();
  const authenticated = await passkey(request("/api/auth/passkeys", { action: "authenticate", response }));
  expect(authenticated.status).toBe(200);
  state.cookie = authenticated.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
  expect(state.cookie).not.toBe(oldToken); expect(state.store[oldKey]).toBeUndefined();
  expect(JSON.parse(state.store[sessionKey()]!)).toMatchObject({ level: "mfa", passkeyVerifiedAt: expect.any(Number) });
  expect(await validateSecuritySession()).toBe(true); await expect(Dashboard()).resolves.toBeTruthy();
  await passwordLogin();
  expect((await passkey(request("/api/auth/passkeys", { action: "authenticate", response }))).status).toBe(401);
  expect(await validateSecuritySession()).toBe(false);
});
it.each(["missing-proof", "early-proof", "epoch", "generation", "absolute", "idle"])("rejects invalid persisted MFA state: %s", async condition => {
  await passwordLogin(); const key = sessionKey(); const session = JSON.parse(state.store[key]!);
  session.level = "mfa"; session.passkeyVerifiedAt = session.createdAt;
  if (condition === "missing-proof") delete session.passkeyVerifiedAt;
  if (condition === "early-proof") session.passkeyVerifiedAt = session.createdAt - 1;
  if (condition === "epoch") session.epoch = 2;
  if (condition === "generation") session.generation = "revoked";
  if (condition === "absolute") session.createdAt = Date.now() - 14_400_001;
  if (condition === "idle") session.lastSeenAt = Date.now() - 900_001;
  state.store[key] = JSON.stringify(session);
  expect(await validateSecuritySession()).toBe(false);
});
