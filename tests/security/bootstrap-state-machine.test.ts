import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as readBootstrapStatus } from "@/app/api/admin/auth/bootstrap/status/route";
import {
  emptyAuthState,
  parseAuthState,
  type AuthState,
  type PasskeyRecord,
} from "@/lib/domain/auth";
import { resolveAdministratorAuthState } from "@/lib/server/auth/state-machine";
import {
  createBootstrapPreAuthentication,
  createPreAuthentication,
  createSession,
  readBootstrapPreAuthentication,
  setBootstrapPreAuthenticationCookie,
} from "@/lib/server/auth/session";
import { cookieNames } from "@/lib/server/cookies";
import {
  bootstrapEnrollmentRuntimePermitted,
} from "@/lib/server/env";
import { assertBootstrapEnrollmentRequest } from "@/lib/server/request";

let testDirectory = "";
let statePath = "";

function passkey(): PasskeyRecord {
  return {
    id: "bootstrap-state-test-credential",
    publicKey: "AQID",
    counter: 0,
    transports: ["internal"],
    createdAt: "2026-08-21T12:00:00.000Z",
    label: "Primary passkey",
  };
}

function activeState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    schemaVersion: 2,
    state: "ACTIVE",
    revision: 4,
    administratorUserId: "stable-administrator-id",
    sessionEpoch: 9,
    passkeys: [passkey()],
    recoveryCodeHashes: ["a".repeat(64)],
    revokedSessionHashes: [],
    ...overrides,
  };
}

async function writeAuthState(state: AuthState): Promise<void> {
  await writeFile(
    statePath,
    `${JSON.stringify({ auth: state }, null, 2)}\n`,
    "utf8",
  );
}

function productionEnrollmentEnvironment(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "https://admin.speedzonems.com");
  vi.stubEnv("WEBAUTHN_RP_ID", "speedzonems.com");
}

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-bootstrap-state-"));
  statePath = join(testDirectory, "state.json");
  vi.stubEnv("LOCAL_STATE_PATH", statePath);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "http://localhost:4173");
  vi.stubEnv("WEBAUTHN_RP_ID", "localhost");
  vi.stubEnv("ALLOW_INSECURE_WEBAUTHN_TEST_ORIGIN", "true");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");
  vi.stubEnv("AUTH_GLOBAL_CONFIG", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(testDirectory, { recursive: true, force: true });
});

describe("administrator authentication state machine", () => {
  it("rejects malformed and unknown lifecycle records instead of guessing a state", () => {
    expect(() => parseAuthState({ ...emptyAuthState(), state: "SURPRISE" })).toThrow();
    expect(() =>
      parseAuthState({
        ...activeState(),
        passkeys: [],
      }),
    ).toThrow();
    expect(() => parseAuthState(null)).toThrow();
  });

  it("migrates a valid legacy active record into the explicit ACTIVE state", () => {
    const migrated = parseAuthState({
      schemaVersion: 1,
      revision: 7,
      administratorUserId: "legacy-administrator",
      bootstrapDisabled: true,
      sessionEpoch: 3,
      passkeys: [passkey()],
      recoveryCodeHashes: ["b".repeat(64)],
      revokedSessionHashes: [],
    });

    expect(migrated).toMatchObject({
      schemaVersion: 2,
      state: "ACTIVE",
      revision: 7,
      sessionEpoch: 3,
    });
  });

  it("reports UNCONFIGURED and disables setup when a required environment value is absent", async () => {
    vi.stubEnv("ADMIN_ID", "");

    await expect(resolveAdministratorAuthState()).resolves.toEqual({ state: "UNCONFIGURED" });
    const response = await readBootstrapStatus();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("treats a bootstrap-ready record without the token hash as UNCONFIGURED", async () => {
    await writeAuthState(emptyAuthState());
    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN_HASH", "");

    await expect(resolveAdministratorAuthState()).resolves.toEqual({ state: "UNCONFIGURED" });
  });

  it("ignores a removed bootstrap-token hash after activation and disables setup", async () => {
    await writeAuthState(activeState());
    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN_HASH", "");

    await expect(resolveAdministratorAuthState()).resolves.toEqual({ state: "ACTIVE" });
    const response = await readBootstrapStatus();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Not found" },
    });

    expect(() => createPreAuthentication(activeState())).not.toThrow();
    expect(() => createSession(activeState())).not.toThrow();
  });
});

describe("final-domain enrollment gate", () => {
  it("permits the explicit non-Vercel loopback E2E origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "http://localhost:4183");

    expect(bootstrapEnrollmentRuntimePermitted()).toBe(true);
    await expect(resolveAdministratorAuthState()).resolves.toEqual({ state: "BOOTSTRAP_READY" });
  });

  it("permits only the explicit production HTTPS origin and never derives it from Host", () => {
    productionEnrollmentEnvironment();
    const request = new NextRequest("https://untrusted-host.invalid/api/admin/auth/bootstrap/preauth", {
      method: "POST",
      headers: {
        host: "untrusted-host.invalid",
        "x-forwarded-host": "preview-untrusted.vercel.app",
        origin: "https://admin.speedzonems.com",
      },
    });

    expect(bootstrapEnrollmentRuntimePermitted()).toBe(true);
    expect(() => assertBootstrapEnrollmentRequest(request)).not.toThrow();
  });

  it.each([
    ["a Vercel preview deployment", { VERCEL_ENV: "preview" }],
    ["a non-HTTPS production origin", { WEBAUTHN_EXPECTED_ORIGIN: "http://admin.speedzonems.com" }],
    ["an RP ID unrelated to the expected origin", { WEBAUTHN_RP_ID: "other.example" }],
    ["a non-canonical expected origin", { WEBAUTHN_EXPECTED_ORIGIN: "https://admin.speedzonems.com/setup" }],
  ])("rejects %s", (_name, overrides) => {
    productionEnrollmentEnvironment();
    for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value);

    expect(bootstrapEnrollmentRuntimePermitted()).toBe(false);
  });

  it("rejects a request Origin that differs from the explicit expected origin", () => {
    productionEnrollmentEnvironment();
    const request = new NextRequest("https://admin.speedzonems.com/api/admin/auth/bootstrap/preauth", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(() => assertBootstrapEnrollmentRequest(request)).toThrow(/rejected/i);
  });
});

describe("bootstrap-only pre-authentication cookie", () => {
  it("is opaque, hardened, purpose-scoped, and expires within five minutes", () => {
    const state = emptyAuthState();
    const now = 1_000_000;
    const claims = createBootstrapPreAuthentication(state, now);
    const response = new NextResponse();
    setBootstrapPreAuthenticationCookie(response, claims);
    const cookie = response.cookies.get(cookieNames.bootstrap);

    expect(cookie).toMatchObject({
      name: "__Host-sz-bootstrap",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 300,
    });
    expect(cookie?.value).not.toContain("administrator");
    expect(cookie?.value).not.toContain(claims.sid);

    const request = new NextRequest("http://localhost:4173/api/admin/auth/bootstrap/options", {
      headers: { cookie: `${cookieNames.bootstrap}=${cookie?.value}` },
    });
    expect(readBootstrapPreAuthentication(request, state, now + 299_999)).toMatchObject({
      typ: "bootstrap-preauth-v1",
      sid: claims.sid,
      recordRevision: state.revision,
    });
    expect(readBootstrapPreAuthentication(request, state, now + 300_000)).toBeNull();
    expect(() => createSession(state, now)).toThrow(/not active/i);
    expect(() => createPreAuthentication(state, now)).toThrow(/not active/i);

    const tampered = new NextRequest("http://localhost:4173/api/admin/auth/bootstrap/options", {
      headers: { cookie: `${cookieNames.bootstrap}=${cookie?.value}A` },
    });
    expect(readBootstrapPreAuthentication(tampered, state, now + 1)).toBeNull();
  });
});
