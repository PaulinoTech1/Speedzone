import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { argon2id, hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const webAuthnMocks = vi.hoisted(() => ({
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", async () => {
  const actual = await vi.importActual<typeof import("@simplewebauthn/server")>(
    "@simplewebauthn/server",
  );
  return {
    ...actual,
    verifyAuthenticationResponse: webAuthnMocks.verifyAuthenticationResponse,
    verifyRegistrationResponse: webAuthnMocks.verifyRegistrationResponse,
  };
});

import { POST as activateBootstrap } from "@/app/api/admin/auth/bootstrap/verify/route";
import { POST as passwordLogin } from "@/app/api/admin/auth/password/route";
import { POST as beginRecoveryEnrollment } from "@/app/api/admin/auth/recovery/options/route";
import { POST as rotateRecoveryCodes } from "@/app/api/admin/auth/recovery/rotate/route";
import { POST as startRecovery } from "@/app/api/admin/auth/recovery/start/route";
import { POST as verifyStepUpPassword } from "@/app/api/admin/auth/step-up/password/route";
import { POST as beginStepUp } from "@/app/api/admin/auth/step-up/options/route";
import { POST as verifyStepUp } from "@/app/api/admin/auth/step-up/verify/route";
import { POST as beginLoginPasskey } from "@/app/api/admin/auth/webauthn/options/route";
import { POST as verifyLoginPasskey } from "@/app/api/admin/auth/webauthn/verify/route";
import { GET as getSession } from "@/app/api/admin/auth/session/route";
import type {
  AuthState,
  BootstrapPreAuthClaims,
  CeremonyClaims,
  SessionClaims,
} from "@/lib/domain/auth";
import {
  createRecoveryProof,
  readRecoveryProof,
  setRecoveryProof,
} from "@/app/api/admin/auth/_shared";
import {
  createBootstrapPreAuthentication,
  setBootstrapPreAuthenticationCookie,
} from "@/lib/server/auth/session";
import { cookieNames } from "@/lib/server/cookies";
import { base64url, sha256 } from "@/lib/server/crypto";
import { issueCsrf } from "@/lib/server/csrf";
import { recoveryCodeHash } from "@/lib/server/auth/recovery";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { ceremonyBinding, setCeremony } from "@/lib/server/auth/webauthn";
import { openToken } from "@/lib/server/token";

const administrator = "administrator";
const password = "Bootstrap activation test password 2026!";
const bootstrapToken = "ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE";

type CookieJar = Map<string, string>;

let passwordHash = "";
let testDirectory = "";
let statePath = "";
let securityPath = "";
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

async function readState(): Promise<AuthState> {
  const stored = JSON.parse(await readFile(statePath, "utf8")) as { auth: AuthState };
  return stored.auth;
}

function jarFromResponse(response: NextResponse): CookieJar {
  const jar = new Map<string, string>();
  absorbCookies(jar, response);
  return jar;
}

function absorbCookies(jar: CookieJar, response: NextResponse): void {
  for (const cookie of response.cookies.getAll()) {
    if (!cookie.value || cookie.maxAge === 0) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function postRequest(
  path: string,
  body: unknown,
  jar: CookieJar,
  csrfToken: string,
  client = `activation-client-${++clientSequence}`,
): NextRequest {
  return new NextRequest(`http://localhost:4173${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:4173",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "x-forwarded-for": `198.51.100.${clientSequence + 20}`,
      "x-vercel-ja4-digest": `ja4-${client}`,
      "user-agent": client,
      cookie: cookieHeader(jar),
    },
    body: JSON.stringify(body),
  });
}

function registrationResponse(id = base64url(randomBytes(32))) {
  return {
    response: {
      id,
      rawId: id,
      type: "public-key" as const,
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
      response: {
        attestationObject: "AA",
        clientDataJSON: "AA",
        transports: ["internal"],
      },
    },
  };
}

function authenticationResponse(id: string) {
  return {
    response: {
      id,
      rawId: id,
      type: "public-key" as const,
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
      response: {
        authenticatorData: "AA",
        clientDataJSON: "AA",
        signature: "AA",
      },
    },
  };
}

function bootstrapCeremony(
  state: AuthState,
  claims: BootstrapPreAuthClaims,
  label: string,
): CeremonyClaims {
  return {
    typ: "ceremony-v1",
    purpose: "bootstrap",
    challenge: base64url(randomBytes(32)),
    jti: base64url(randomBytes(32)),
    boundSessionHash: ceremonyBinding(claims.sid),
    administrator,
    recordRevision: state.revision,
    label,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 5 * 60_000,
  };
}

function bootstrapCookies(
  state: AuthState,
  label: string,
  now = Date.now(),
): { jar: CookieJar; csrfToken: string } {
  const claims = createBootstrapPreAuthentication(state, now);
  const carrier = new NextResponse();
  setBootstrapPreAuthenticationCookie(carrier, claims);
  setCeremony(carrier, bootstrapCeremony(state, claims, label));
  const csrfToken = issueCsrf(carrier, claims.sid);
  return { jar: jarFromResponse(carrier), csrfToken };
}

function anonymousCsrf(): { jar: CookieJar; csrfToken: string } {
  const carrier = new NextResponse();
  const csrfToken = issueCsrf(carrier, "anonymous");
  return { jar: jarFromResponse(carrier), csrfToken };
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
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-bootstrap-activation-"));
  statePath = join(testDirectory, "state.json");
  securityPath = join(testDirectory, "security-consume");
  vi.stubEnv("LOCAL_STATE_PATH", statePath);
  vi.stubEnv("LOCAL_SECURITY_PATH", securityPath);
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

  webAuthnMocks.verifyRegistrationResponse.mockReset();
  webAuthnMocks.verifyAuthenticationResponse.mockReset();
  webAuthnMocks.verifyRegistrationResponse.mockImplementation(async ({ response }) => ({
    verified: true,
    registrationInfo: {
      userVerified: true,
      credential: {
        id: response.id,
        publicKey: randomBytes(77),
        counter: 0,
        transports: ["internal"],
      },
    },
  }));
  webAuthnMocks.verifyAuthenticationResponse.mockResolvedValue({
    verified: true,
    authenticationInfo: { userVerified: true, newCounter: 0 },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(testDirectory, { recursive: true, force: true });
});

describe("atomic bootstrap activation", () => {
  it("commits one complete ACTIVE record and rejects a duplicate response without changing it", async () => {
    const initial = bootstrapReadyState();
    const fixture = bootstrapCookies(initial, "Primary security key");
    const responseBody = registrationResponse();
    const request = () =>
      postRequest(
        "/api/admin/auth/bootstrap/verify",
        responseBody,
        fixture.jar,
        fixture.csrfToken,
      );

    const first = await activateBootstrap(request());
    expect(first.status).toBe(200);
    const body = await first.json() as {
      ok: boolean;
      authenticated: boolean;
      setupComplete: boolean;
      next: string;
      recoveryCodes: string[];
    };
    expect(body).toMatchObject({
      ok: true,
      authenticated: false,
      setupComplete: true,
      next: "login",
    });
    expect(body.recoveryCodes).toHaveLength(10);
    expect(new Set(body.recoveryCodes)).toHaveLength(10);
    expect(first.cookies.get(cookieNames.session)?.value ?? "").toBe("");
    expect(first.cookies.get(cookieNames.bootstrap)?.value ?? "").toBe("");
    expect(first.cookies.get(cookieNames.ceremony)?.value ?? "").toBe("");

    const activated = await readState();
    expect(activated).toMatchObject({
      schemaVersion: 2,
      state: "ACTIVE",
      revision: 1,
      passkeys: [{ id: responseBody.response.id, label: "Primary security key" }],
    });
    expect(activated.sessionEpoch).toBeGreaterThan(initial.sessionEpoch);
    expect(activated.recoveryCodeHashes).toHaveLength(10);
    expect(new Set(activated.recoveryCodeHashes)).toEqual(
      new Set(body.recoveryCodes.map(recoveryCodeHash)),
    );
    const serializedState = JSON.stringify(activated);
    for (const code of body.recoveryCodes) expect(serializedState).not.toContain(code);

    const replay = await activateBootstrap(request());
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
    expect(await readState()).toEqual(activated);
    expect(webAuthnMocks.verifyRegistrationResponse).toHaveBeenCalledTimes(1);
  });

  it("allows exactly one of two competing enrollment attempts to activate", async () => {
    const initial = bootstrapReadyState();
    const firstFixture = bootstrapCookies(initial, "Competing key A");
    const secondFixture = bootstrapCookies(initial, "Competing key B");
    const firstBody = registrationResponse();
    const secondBody = registrationResponse();

    const responses = await Promise.all([
      activateBootstrap(
        postRequest(
          "/api/admin/auth/bootstrap/verify",
          firstBody,
          firstFixture.jar,
          firstFixture.csrfToken,
          "concurrent-a",
        ),
      ),
      activateBootstrap(
        postRequest(
          "/api/admin/auth/bootstrap/verify",
          secondBody,
          secondFixture.jar,
          secondFixture.csrfToken,
          "concurrent-b",
        ),
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const activated = await readState();
    expect(activated.state).toBe("ACTIVE");
    expect(activated.revision).toBe(1);
    expect(activated.passkeys).toHaveLength(1);
    expect([firstBody.response.id, secondBody.response.id]).toContain(activated.passkeys[0]?.id);
    expect(activated.recoveryCodeHashes).toHaveLength(10);
  });

  it("rejects an expired bootstrap session before WebAuthn verification", async () => {
    const initial = bootstrapReadyState();
    const expired = bootstrapCookies(
      initial,
      "Expired key",
      Date.now() - 5 * 60_000 - 1,
    );
    const response = await activateBootstrap(
      postRequest(
        "/api/admin/auth/bootstrap/verify",
        registrationResponse(),
        expired.jar,
        expired.csrfToken,
      ),
    );

    expect(response.status).toBe(401);
    expect(webAuthnMocks.verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(await readState()).toEqual(initial);
  });
});

describe("interrupted bootstrap response recovery", () => {
  it("supports fresh password-plus-passkey login and code rotation after token-hash removal", async () => {
    const initial = bootstrapReadyState();
    const fixture = bootstrapCookies(initial, "Interrupted response key");
    const registration = registrationResponse();
    const activationResponse = await activateBootstrap(
      postRequest(
        "/api/admin/auth/bootstrap/verify",
        registration,
        fixture.jar,
        fixture.csrfToken,
      ),
    );

    // Simulate a client disconnect: do not consume the response body or its
    // one-time plaintext recovery codes. The authoritative record is already complete.
    expect(activationResponse.status).toBe(200);
    expect(activationResponse.cookies.get(cookieNames.session)?.value ?? "").toBe("");
    const activated = await readState();
    expect(activated).toMatchObject({ state: "ACTIVE", revision: 1 });
    expect(activated.passkeys).toHaveLength(1);
    expect(activated.recoveryCodeHashes).toHaveLength(10);

    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN_HASH", "");
    const anonymous = anonymousCsrf();
    const passwordResponse = await passwordLogin(
      postRequest(
        "/api/admin/auth/password",
        { adminId: administrator, password },
        anonymous.jar,
        anonymous.csrfToken,
        "fresh-password-login",
      ),
    );
    expect(passwordResponse.status).toBe(200);
    const passwordBody = await passwordResponse.json() as { csrfToken: string };
    const loginJar = jarFromResponse(passwordResponse);
    expect(loginJar.has(cookieNames.preAuth)).toBe(true);
    expect(loginJar.has(cookieNames.session)).toBe(false);

    const optionsResponse = await beginLoginPasskey(
      postRequest(
        "/api/admin/auth/webauthn/options",
        {},
        loginJar,
        passwordBody.csrfToken,
        "fresh-passkey-options",
      ),
    );
    expect(optionsResponse.status).toBe(200);
    absorbCookies(loginJar, optionsResponse);

    const loginResponse = await verifyLoginPasskey(
      postRequest(
        "/api/admin/auth/webauthn/verify",
        authenticationResponse(registration.response.id),
        loginJar,
        passwordBody.csrfToken,
        "fresh-passkey-verify",
      ),
    );
    expect(loginResponse.status).toBe(200);
    const loginBody = await loginResponse.json() as {
      authenticated: boolean;
      csrfToken: string;
    };
    expect(loginBody.authenticated).toBe(true);
    const sessionJar = jarFromResponse(loginResponse);
    expect(sessionJar.has(cookieNames.preAuth)).toBe(false);
    const sessionClaims = openToken<SessionClaims>(sessionJar.get(cookieNames.session));
    expect(sessionClaims).toMatchObject({ typ: "session-v1", epoch: activated.sessionEpoch });

    // Inventory now lives in Sanity (a separately configured subsystem), so an
    // inventory route is no longer a valid "is this session authenticated"
    // probe; the session-status route proves the same thing without that
    // incidental coupling.
    const sessionCheckResponse = await getSession(
      new NextRequest("http://localhost:4173/api/admin/auth/session", {
        headers: { cookie: cookieHeader(sessionJar) },
      }),
    );
    expect(sessionCheckResponse.status).toBe(200);

    const passwordStepUpResponse = await verifyStepUpPassword(
      postRequest(
        "/api/admin/auth/step-up/password",
        { adminId: administrator, password },
        sessionJar,
        loginBody.csrfToken,
        "recovery-rotation-password",
      ),
    );
    expect(passwordStepUpResponse.status).toBe(200);
    absorbCookies(sessionJar, passwordStepUpResponse);

    const stepUpOptionsResponse = await beginStepUp(
      postRequest(
        "/api/admin/auth/step-up/options",
        {},
        sessionJar,
        loginBody.csrfToken,
        "recovery-rotation-options",
      ),
    );
    expect(stepUpOptionsResponse.status).toBe(200);
    absorbCookies(sessionJar, stepUpOptionsResponse);

    const stepUpResponse = await verifyStepUp(
      postRequest(
        "/api/admin/auth/step-up/verify",
        authenticationResponse(registration.response.id),
        sessionJar,
        loginBody.csrfToken,
        "recovery-rotation-passkey",
      ),
    );
    expect(stepUpResponse.status).toBe(200);
    absorbCookies(sessionJar, stepUpResponse);
    expect(sessionJar.has(cookieNames.stepUp)).toBe(true);

    const replayedStepUpJar = new Map(sessionJar);
    const rotateResponse = await rotateRecoveryCodes(
      postRequest(
        "/api/admin/auth/recovery/rotate",
        {},
        sessionJar,
        loginBody.csrfToken,
        "recovery-rotation-final",
      ),
    );
    expect(rotateResponse.status).toBe(200);
    const rotateBody = await rotateResponse.json() as { recoveryCodes: string[] };
    expect(rotateBody.recoveryCodes).toHaveLength(10);
    expect(new Set(rotateBody.recoveryCodes)).toHaveLength(10);
    const afterRotation = await readState();
    expect(afterRotation.state).toBe("ACTIVE");
    expect(afterRotation.recoveryCodeHashes).not.toEqual(activated.recoveryCodeHashes);
    expect(new Set(afterRotation.recoveryCodeHashes)).toEqual(
      new Set(rotateBody.recoveryCodes.map(recoveryCodeHash)),
    );

    const replay = await rotateRecoveryCodes(
      postRequest(
        "/api/admin/auth/recovery/rotate",
        {},
        replayedStepUpJar,
        loginBody.csrfToken,
        "recovery-rotation-stepup-replay",
      ),
    );
    expect(replay.status).toBe(403);
    await expect(replay.json()).resolves.toMatchObject({
      error: { code: "STEP_UP_REQUIRED" },
    });
    expect(await readState()).toEqual(afterRotation);
  });
});

describe("interrupted recovery resume", () => {
  it("rejects an expired proof and resumes RECOVERY without another state mutation", async () => {
    const recoveryCode = "ABCDE-FGHIJ-KLMNP-QRSTU-VWXYZ-A";
    const codeHash = recoveryCodeHash(recoveryCode);
    const credentialId = base64url(randomBytes(32));
    const active: AuthState = {
      schemaVersion: 2,
      state: "ACTIVE",
      revision: 0,
      administratorUserId: "recovery-resume-administrator",
      sessionEpoch: 6,
      passkeys: [
        {
          id: credentialId,
          publicKey: base64url(randomBytes(77)),
          counter: 0,
          transports: ["internal"],
          createdAt: "2026-08-21T12:00:00.000Z",
          label: "Lost primary passkey",
        },
      ],
      recoveryCodeHashes: [codeHash],
      revokedSessionHashes: [],
    };
    await writeState(active);

    const firstAnonymous = anonymousCsrf();
    const first = await startRecovery(
      postRequest(
        "/api/admin/auth/recovery/start",
        { identifier: administrator, password, recoveryCode },
        firstAnonymous.jar,
        firstAnonymous.csrfToken,
        "recovery-enter",
      ),
    );
    expect(first.status).toBe(200);
    const recoveryState = await readState();
    expect(recoveryState.state).toBe("RECOVERY");
    expect(recoveryState.revision).toBe(active.revision + 1);
    expect(recoveryState.sessionEpoch).toBeGreaterThan(active.sessionEpoch);

    const expiredProof = createRecoveryProof(
      recoveryState,
      codeHash,
      Date.now() - 5 * 60_000 - 1,
    );
    const expiredCarrier = new NextResponse();
    setRecoveryProof(expiredCarrier, expiredProof);
    const expiredCsrf = issueCsrf(expiredCarrier, expiredProof.sid);
    const expiredJar = jarFromResponse(expiredCarrier);
    const expiredRequest = new NextRequest(
      "http://localhost:4173/api/admin/auth/recovery/options",
      { headers: { cookie: cookieHeader(expiredJar) } },
    );
    expect(readRecoveryProof(expiredRequest, recoveryState)).toBeNull();

    const expiredOptions = await beginRecoveryEnrollment(
      postRequest(
        "/api/admin/auth/recovery/options",
        { label: "Replacement passkey" },
        expiredJar,
        expiredCsrf,
        "expired-recovery-proof",
      ),
    );
    expect(expiredOptions.status).toBe(401);

    const resumeAnonymous = anonymousCsrf();
    const resumed = await startRecovery(
      postRequest(
        "/api/admin/auth/recovery/start",
        { identifier: administrator, password, recoveryCode },
        resumeAnonymous.jar,
        resumeAnonymous.csrfToken,
        "recovery-resume",
      ),
    );
    expect(resumed.status).toBe(200);
    const resumedBody = await resumed.json() as {
      recoveryAuthorized: boolean;
      csrfToken: string;
    };
    expect(resumedBody.recoveryAuthorized).toBe(true);
    expect(await readState()).toEqual(recoveryState);

    const resumedJar = jarFromResponse(resumed);
    const resumedRequest = new NextRequest(
      "http://localhost:4173/api/admin/auth/recovery/options",
      { headers: { cookie: cookieHeader(resumedJar) } },
    );
    expect(readRecoveryProof(resumedRequest, recoveryState)).toMatchObject({
      typ: "recovery-v1",
      recoveryCodeHash: codeHash,
      recordRevision: recoveryState.revision,
      epoch: recoveryState.sessionEpoch,
    });
  });
});
