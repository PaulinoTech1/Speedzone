import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { argon2id, hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as passwordRoute from "@/app/api/admin/auth/password/route";
import { GET as readSession } from "@/app/api/admin/auth/session/route";
import type { AuthState, PreAuthClaims } from "@/lib/domain/auth";
import { cookieNames } from "@/lib/server/cookies";
import { issueCsrf } from "@/lib/server/csrf";
import { base64url } from "@/lib/server/crypto";
import { ipSecurityHash } from "@/lib/server/security-log";
import { checkRateLimit, resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { openToken } from "@/lib/server/token";

const specialPassword = `  d'Artagnan said "<keep-this>" — 密碼 😀 and {"adminId":"still-password"}  `;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const originalAdministrator = process.env.ADMIN_ID;

let specialPasswordHash = "";
let testDirectory = "";
let statePath = "";
let requestSequence = 0;

function authState(): AuthState {
  return {
    schemaVersion: 2,
    state: "ACTIVE",
    revision: 0,
    administratorUserId: "test-administrator",
    sessionEpoch: 7,
    passkeys: [
      {
        id: base64url(randomBytes(32)),
        publicKey: base64url(randomBytes(77)),
        counter: 0,
        transports: ["internal"],
        createdAt: new Date().toISOString(),
        label: "Login test passkey",
      },
    ],
    recoveryCodeHashes: ["a".repeat(64)],
    revokedSessionHashes: [],
  };
}

async function writeState(state = authState()): Promise<void> {
  await writeFile(
    statePath,
    `${JSON.stringify({ auth: state }, null, 2)}\n`,
    "utf8",
  );
}

function cookieHeader(response: NextResponse): string {
  return response.cookies
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

type LoginRequestOptions = {
  contentType?: string | null;
  contentLength?: number;
  clientId?: string;
};

function loginRequest(
  body: string,
  {
    contentType = "application/json",
    contentLength,
    clientId = `login-test-${++requestSequence}`,
  }: LoginRequestOptions = {},
): NextRequest {
  const csrfCarrier = new NextResponse();
  const csrfToken = issueCsrf(csrfCarrier, "anonymous");
  const headers = new Headers({
    origin: "http://localhost:4173",
    cookie: cookieHeader(csrfCarrier),
    "x-csrf-token": csrfToken,
    "x-forwarded-for": clientId,
    "user-agent": "SpeedZone login validation test",
  });
  if (contentType !== null) headers.set("content-type", contentType);
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new NextRequest("http://localhost:4173/api/admin/auth/password", {
    method: "POST",
    headers,
    body,
  });
}

function jsonLoginBody(adminId: unknown, password: unknown, additions = ""): string {
  const fields = [
    `"adminId":${JSON.stringify(adminId)}`,
    `"password":${JSON.stringify(password)}`,
    additions,
  ].filter(Boolean);
  return `{${fields.join(",")}}`;
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeAll(async () => {
  specialPasswordHash = await hash(specialPassword, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
});

beforeEach(async () => {
  resetRateLimitsForTests();
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-password-route-"));
  statePath = join(testDirectory, "state.json");
  vi.stubEnv("LOCAL_STATE_PATH", statePath);
  vi.stubEnv("ADMIN_ID", "administrator");
  vi.stubEnv("ADMIN_PASSWORD_HASH", specialPasswordHash);
  vi.stubEnv("ADMIN_PASSWORD_PEPPER", "");
  vi.stubEnv("ADMIN_DISABLED", "false");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");
  vi.stubEnv("AUTH_GLOBAL_CONFIG", "");
  await writeState();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(testDirectory, { recursive: true, force: true });
});

afterAll(() => {
  if (originalPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  else process.env.ADMIN_PASSWORD_HASH = originalPasswordHash;
  if (originalAdministrator === undefined) delete process.env.ADMIN_ID;
  else process.env.ADMIN_ID = originalAdministrator;
});

describe("administrator password route input boundary", () => {
  it("exports only the POST handler for login submissions", () => {
    expect(typeof passwordRoute.POST).toBe("function");
    expect("GET" in passwordRoute).toBe(false);
    expect("PUT" in passwordRoute).toBe(false);
  });

  it.each([
    ["missing both fields", `{}`],
    ["missing password", `{"adminId":"administrator"}`],
    ["missing identifier", `{"password":"value"}`],
    ["legacy identifier field", `{"identifier":"administrator","password":"value"}`],
    ["additional field", jsonLoginBody("administrator", "value", `"role":"owner"`)],
    ["top-level array", `["administrator","value"]`],
    ["top-level null", `null`],
    ["null identifier", jsonLoginBody(null, "value")],
    ["array identifier", jsonLoginBody(["administrator"], "value")],
    ["nested identifier", jsonLoginBody({ value: "administrator" }, "value")],
    ["numeric identifier", jsonLoginBody(42, "value")],
    ["null password", jsonLoginBody("administrator", null)],
    ["array password", jsonLoginBody("administrator", ["value"])],
    ["nested password", jsonLoginBody("administrator", { value: "secret" })],
    ["boolean password", jsonLoginBody("administrator", true)],
  ])("rejects %s before password verification", async (_name, body) => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const response = await passwordRoute.POST(loginRequest(body));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Request validation failed" },
    });
  });

  it.each([
    [
      "literal duplicate fields",
      `{"adminId":"administrator","adminId":"other","password":"value"}`,
    ],
    [
      "duplicate fields with an escaped key",
      `{"adminId":"administrator","\\u0061dminId":"other","password":"value"}`,
    ],
    [
      "a prototype-pollution key",
      `{"adminId":"administrator","password":"value","__proto__":{"polluted":true}}`,
    ],
    [
      "a nested constructor/prototype key",
      `{"adminId":"administrator","password":"value","extra":{"constructor":{"prototype":{"polluted":true}}}}`,
    ],
  ])("rejects %s during strict JSON parsing", async (_name, body) => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    const response = await passwordRoute.POST(loginRequest(body));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Request validation failed" },
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects malformed JSON safely before password verification", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const response = await passwordRoute.POST(
      loginRequest(`{"adminId":"administrator","password":`),
    );
    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it.each([
    null,
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/json, text/plain",
    "application/json; charset=utf-8, text/plain",
    "application/json; charset=utf-8; charset=utf-8",
    "application/json; charset=us-ascii",
    "application/json; boundary=login",
  ])(
    "rejects the non-JSON Content-Type %s",
    async (contentType) => {
      vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
      const response = await passwordRoute.POST(
        loginRequest(jsonLoginBody("administrator", specialPassword), { contentType }),
      );
      expect(response.status).toBe(415);
      await expect(responseBody(response)).resolves.toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_MEDIA_TYPE" },
      });
    },
  );

  it.each([
    "application/json; charset=utf-8",
    `Application/JSON; Charset="UTF-8"`,
  ])("accepts the unambiguous JSON media type %s", async (contentType) => {
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", specialPassword), {
        contentType,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects declared and actual bodies above 4 KiB before password verification", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const declared = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", "value"), { contentLength: 4097 }),
    );
    expect(declared.status).toBe(413);
    await expect(responseBody(declared)).resolves.toMatchObject({
      error: { code: "BODY_TOO_LARGE" },
    });

    const actualBody = jsonLoginBody(
      "administrator",
      "value",
      `"padding":"${"a".repeat(4096)}"`,
    );
    expect(Buffer.byteLength(actualBody, "utf8")).toBeGreaterThan(4096);
    const actual = await passwordRoute.POST(loginRequest(actualBody));
    expect(actual.status).toBe(413);
    await expect(responseBody(actual)).resolves.toMatchObject({
      error: { code: "BODY_TOO_LARGE" },
    });
  });

  it("rejects an oversized password before password verification", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const password = "😀".repeat(129);
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", password)),
    );
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("rejects a rate-limited request before password verification", async () => {
    const request = loginRequest(jsonLoginBody("administrator", specialPassword), {
      clientId: "rate-limited-login-client",
    });
    const client = ipSecurityHash(request);
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await checkRateLimit("password", `client:${client}`, now)).allowed).toBe(true);
    }
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const response = await passwordRoute.POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Request limit reached" },
    });
  });

  it("does not let one saturated client consume another client's password budget", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejectedShape = await passwordRoute.POST(
        loginRequest(`{}`, { clientId: "saturated-login-client" }),
      );
      expect(rejectedShape.status).toBe(422);
    }

    const saturated = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", specialPassword), {
        clientId: "saturated-login-client",
      }),
    );
    expect(saturated.status).toBe(429);

    const independent = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", specialPassword), {
        clientId: "independent-login-client",
      }),
    );
    expect(independent.status).toBe(200);
    await expect(responseBody(independent)).resolves.toMatchObject({
      ok: true,
      authenticationStep: "passkey",
    });
  });
});

describe("administrator password authentication behavior", () => {
  it("passes leading/trailing spaces, punctuation, angle brackets, emoji, and Unicode unchanged to Argon2id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", specialPassword)),
    );
    expect(response.status).toBe(200);
    const responseText = await response.text();
    const body = JSON.parse(responseText) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, authenticationStep: "passkey" });
    expect(body).not.toHaveProperty("authenticated");
    const output = `${responseText}\n${[...response.headers].flat().join("\n")}\n${[
      ...info.mock.calls,
      ...error.mock.calls,
    ].flat().join("\n")}`;
    expect(output).not.toContain(specialPassword);
    expect(output).not.toContain(`d'Artagnan`);
  });

  it("normalizes a configured email identifier consistently", async () => {
    vi.stubEnv("ADMIN_ID", "Admin.User+Ops@Example.COM");
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("  ADMIN.USER+OPS@example.com  ", specialPassword)),
    );
    expect(response.status).toBe(200);
    const preAuthentication = openToken<PreAuthClaims>(
      response.cookies.get(cookieNames.preAuth)?.value,
    );
    expect(preAuthentication).toMatchObject({
      typ: "preauth-v1",
      administrator: "admin.user+ops@example.com",
    });
  });

  it("returns indistinguishable failures for a wrong identifier and wrong password", async () => {
    const wrongIdentifier = await passwordRoute.POST(
      loginRequest(jsonLoginBody("different-admin", specialPassword)),
    );
    const wrongPassword = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", "wrong password with enough syntax")),
    );
    expect(wrongIdentifier.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await responseBody(wrongIdentifier)).toEqual(await responseBody(wrongPassword));
    expect(wrongIdentifier.headers.get("cache-control")).toBe(
      wrongPassword.headers.get("cache-control"),
    );
  });

  it("treats an empty primitive password as a wrong credential, not a shape oracle", async () => {
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", "")),
    );
    expect(response.status).toBe(401);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
  });

  it("never places submitted credentials in logs or responses", async () => {
    const adminId = "script.admin";
    const password = `wrong '<script>credential-${crypto.randomUUID()}</script>' 密碼 😀`;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody(adminId, password)),
    );
    const serializedResponse = `${await response.text()}\n${[...response.headers].flat().join("\n")}`;
    const serializedLogs = [...info.mock.calls, ...error.mock.calls].flat().join("\n");
    for (const credential of [adminId, password, "<script>"]) {
      expect(serializedResponse).not.toContain(credential);
      expect(serializedLogs).not.toContain(credential);
    }
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps a script-like identifier out of executable output", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "ARGON-MUST-NOT-RUN");
    const scriptLike = `<script>globalThis.compromised=true</script>`;
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody(scriptLike, specialPassword)),
    );
    const text = await response.text();
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(text).not.toContain(scriptLike);
    expect(text).not.toContain("<script>");
  });

  it("issues only pre-authentication after a valid password", async () => {
    const response = await passwordRoute.POST(
      loginRequest(jsonLoginBody("administrator", specialPassword)),
    );
    expect(response.status).toBe(200);
    const preAuthentication = openToken<PreAuthClaims>(
      response.cookies.get(cookieNames.preAuth)?.value,
    );
    expect(preAuthentication).toMatchObject({
      typ: "preauth-v1",
      administrator: "administrator",
      epoch: 7,
    });
    expect(response.cookies.get(cookieNames.session)?.value ?? "").toBe("");

    const sessionResponse = await readSession(
      new NextRequest("http://localhost:4173/api/admin/auth/session", {
        headers: { cookie: cookieHeader(response) },
      }),
    );
    expect(sessionResponse.status).toBe(401);
    await expect(responseBody(sessionResponse)).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });
});
