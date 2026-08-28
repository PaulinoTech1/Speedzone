import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { argon2id, hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as verifyBootstrapCredentials } from "@/app/api/admin/auth/bootstrap/preauth/route";
import { POST as createInventory } from "@/app/api/admin/inventory/route";
import type { AuthState, BootstrapPreAuthClaims } from "@/lib/domain/auth";
import { cookieNames } from "@/lib/server/cookies";
import { sha256 } from "@/lib/server/crypto";
import { issueCsrf } from "@/lib/server/csrf";
import { ratePolicies, resetRateLimitsForTests } from "@/lib/server/rate-limit";
import {
  enforceBootstrapRateLimit,
  RateLimitError,
} from "@/lib/server/route-utils";
import { openToken } from "@/lib/server/token";

const administrator = "administrator";
const password = `  Bootstrap password with spaces, punctuation '<>&' and Unicode 密碼 😀  `;
const bootstrapToken = "ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE";
const wrongBootstrapToken = Buffer.alloc(32, 34).toString("base64url");

const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const originalBootstrapHash = process.env.ADMIN_BOOTSTRAP_TOKEN_HASH;
let passwordHash = "";
let testDirectory = "";
let statePath = "";
let clientSequence = 0;

function bootstrapReadyState(): AuthState {
  return {
    schemaVersion: 2,
    state: "BOOTSTRAP_READY",
    revision: 0,
    administratorUserId: "",
    sessionEpoch: 0,
    passkeys: [],
    recoveryCodeHashes: [],
    revokedSessionHashes: [],
  };
}

async function writeState(state = bootstrapReadyState()): Promise<void> {
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

function credentialRequest(
  body: unknown,
  clientId = `bootstrap-client-${++clientSequence}`,
): NextRequest {
  const csrfCarrier = new NextResponse();
  const csrfToken = issueCsrf(csrfCarrier, "anonymous");
  return new NextRequest("http://localhost:4173/api/admin/auth/bootstrap/preauth", {
    method: "POST",
    headers: {
      origin: "http://localhost:4173",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "x-forwarded-for": `192.0.2.${clientSequence + 10}`,
      "x-vercel-ja4-digest": `test-ja4-${clientId}`,
      "user-agent": clientId,
      cookie: cookieHeader(csrfCarrier),
    },
    body: JSON.stringify(body),
  });
}

function rateLimitRequest(ip: string, ja4: string): NextRequest {
  return new NextRequest("http://localhost:4173/api/admin/auth/bootstrap/preauth", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "x-vercel-ja4-digest": ja4,
      "user-agent": "bootstrap-rate-limit-test",
    },
  });
}

beforeAll(async () => {
  passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
});

beforeEach(async () => {
  resetRateLimitsForTests();
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-bootstrap-preauth-"));
  statePath = join(testDirectory, "state.json");
  vi.stubEnv("LOCAL_STATE_PATH", statePath);
  vi.stubEnv("ADMIN_ID", administrator);
  vi.stubEnv("ADMIN_PASSWORD_HASH", passwordHash);
  vi.stubEnv("ADMIN_PASSWORD_PEPPER", "");
  vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN_HASH", sha256(bootstrapToken));
  vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "http://localhost:4173");
  vi.stubEnv("WEBAUTHN_RP_ID", "localhost");
  vi.stubEnv("ALLOW_INSECURE_WEBAUTHN_TEST_ORIGIN", "true");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
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
  if (originalBootstrapHash === undefined) delete process.env.ADMIN_BOOTSTRAP_TOKEN_HASH;
  else process.env.ADMIN_BOOTSTRAP_TOKEN_HASH = originalBootstrapHash;
});

describe("bootstrap credential verification", () => {
  it("issues only a purpose-scoped bootstrap pre-authentication cookie", async () => {
    const response = await verifyBootstrapCredentials(
      credentialRequest({ adminId: administrator, password, bootstrapToken }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: boolean;
      bootstrapAuthorized: boolean;
      csrfToken: string;
    };
    expect(body).toMatchObject({ ok: true, bootstrapAuthorized: true });
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.cookies.get(cookieNames.session)?.value ?? "").toBe("");
    expect(response.cookies.get(cookieNames.preAuth)?.value ?? "").toBe("");

    const claims = openToken<BootstrapPreAuthClaims>(
      response.cookies.get(cookieNames.bootstrap)?.value,
    );
    expect(claims).toMatchObject({
      typ: "bootstrap-preauth-v1",
      administrator,
      recordRevision: 0,
      epoch: 0,
    });
    expect((claims?.expiresAt ?? 0) - (claims?.issuedAt ?? 0)).toBeLessThanOrEqual(5 * 60_000);
    expect(Buffer.from(claims?.sid ?? "", "base64url")).toHaveLength(32);

    const inventoryResponse = await createInventory(
      new NextRequest("http://localhost:4173/api/admin/inventory", {
        method: "POST",
        headers: {
          origin: "http://localhost:4173",
          "content-type": "application/json",
          "x-csrf-token": body.csrfToken,
          cookie: cookieHeader(response),
        },
        body: "{}",
      }),
    );
    expect(inventoryResponse.status).toBe(401);
    await expect(inventoryResponse.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("returns indistinguishable failures for an incorrect ID, password, or token", async () => {
    const secretPassword = `wrong-password-${randomBytes(8).toString("hex")}`;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const responses = await Promise.all([
      verifyBootstrapCredentials(
        credentialRequest({ adminId: "different-admin", password, bootstrapToken }, "wrong-id"),
      ),
      verifyBootstrapCredentials(
        credentialRequest({ adminId: administrator, password: secretPassword, bootstrapToken }, "wrong-password"),
      ),
      verifyBootstrapCredentials(
        credentialRequest({ adminId: administrator, password, bootstrapToken: wrongBootstrapToken }, "wrong-token"),
      ),
    ]);

    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });

    const output = `${JSON.stringify(bodies)}\n${[
      ...info.mock.calls,
      ...error.mock.calls,
    ].flat().join("\n")}`;
    for (const submitted of [password, secretPassword, bootstrapToken, wrongBootstrapToken]) {
      expect(output).not.toContain(submitted);
    }
  });

  it("accepts only the exact strict body shape and never accepts credentials in the URL", async () => {
    const unknownField = await verifyBootstrapCredentials(
      credentialRequest({
        adminId: administrator,
        password,
        bootstrapToken,
        role: "owner",
      }),
    );
    expect(unknownField.status).toBe(422);

    const csrfCarrier = new NextResponse();
    const csrfToken = issueCsrf(csrfCarrier, "anonymous");
    const queryOnly = await verifyBootstrapCredentials(
      new NextRequest(
        `http://localhost:4173/api/admin/auth/bootstrap/preauth?adminId=${administrator}&password=secret&bootstrapToken=${bootstrapToken}`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost:4173",
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            "x-forwarded-for": "198.51.100.24",
            cookie: cookieHeader(csrfCarrier),
          },
          body: "{}",
        },
      ),
    );
    expect(queryOnly.status).toBe(422);
    expect(await queryOnly.text()).not.toContain(bootstrapToken);
  });
});

describe("bootstrap verification rate limit", () => {
  it("allows three attempts per 30 minutes and keys independently by IP and JA4", () => {
    expect(ratePolicies.bootstrap).toEqual({ limit: 3, windowMs: 30 * 60_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() =>
        enforceBootstrapRateLimit(rateLimitRequest("203.0.113.10", `unique-ja4-${attempt}`)),
      ).not.toThrow();
    }
    expect(() =>
      enforceBootstrapRateLimit(rateLimitRequest("203.0.113.10", "unique-ja4-4")),
    ).toThrow(RateLimitError);

    resetRateLimitsForTests();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() =>
        enforceBootstrapRateLimit(rateLimitRequest(`203.0.113.${attempt + 20}`, "shared-ja4")),
      ).not.toThrow();
    }
    expect(() =>
      enforceBootstrapRateLimit(rateLimitRequest("203.0.113.30", "shared-ja4")),
    ).toThrow(RateLimitError);
  });
});
