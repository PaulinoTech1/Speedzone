import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyAuthenticationResponseMock = vi.hoisted(() => vi.fn());

vi.mock("@simplewebauthn/server", async () => {
  const actual = await vi.importActual<typeof import("@simplewebauthn/server")>(
    "@simplewebauthn/server",
  );
  return {
    ...actual,
    verifyAuthenticationResponse: verifyAuthenticationResponseMock,
  };
});

import { POST as finalizeRecovery } from "@/app/api/admin/auth/recovery/finalize/route";
import { POST as verifyWebAuthn } from "@/app/api/admin/auth/webauthn/verify/route";
import {
  createRecoveryProof,
  setPendingRecovery,
} from "@/app/api/admin/auth/_shared";
import type {
  AuthState,
  CeremonyClaims,
  PasskeyRecord,
  SessionClaims,
} from "@/lib/domain/auth";
import { emptyInventoryState } from "@/lib/domain/vehicle";
import {
  createPreAuthentication,
  setPreAuthenticationCookie,
} from "@/lib/server/auth/session";
import { recoveryCodeHash } from "@/lib/server/auth/recovery";
import {
  ceremonyBinding,
  setCeremony,
} from "@/lib/server/auth/webauthn";
import { base64url } from "@/lib/server/crypto";
import { cookieNames } from "@/lib/server/cookies";
import { issueCsrf } from "@/lib/server/csrf";
import { openToken } from "@/lib/server/token";

let testDirectory = "";
let statePath = "";

function passkey(label: string): PasskeyRecord {
  return {
    id: base64url(randomBytes(32)),
    publicKey: base64url(randomBytes(77)),
    counter: 0,
    transports: ["internal"],
    createdAt: new Date().toISOString(),
    label,
  };
}

async function writeState(auth: AuthState): Promise<void> {
  await writeFile(
    statePath,
    `${JSON.stringify({ auth, inventory: emptyInventoryState() }, null, 2)}\n`,
    "utf8",
  );
}

function cookiesFrom(response: NextResponse): string {
  return response.cookies
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function postRequest(path: string, body: unknown, cookie: string, csrfToken: string): NextRequest {
  return new NextRequest(`http://localhost:4173${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:4173",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      cookie,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-auth-route-"));
  statePath = join(testDirectory, "state.json");
  process.env.LOCAL_STATE_PATH = statePath;
  process.env.LOCAL_SECURITY_PATH = join(testDirectory, "security-consume");
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  verifyAuthenticationResponseMock.mockReset();
});

afterEach(async () => {
  delete process.env.LOCAL_STATE_PATH;
  delete process.env.LOCAL_SECURITY_PATH;
  await rm(testDirectory, { recursive: true, force: true });
});

describe("route-level one-time authentication proofs", () => {
  it("accepts a WebAuthn challenge once and blocks an identical replay before verification", async () => {
    const credential = passkey("Replay test key");
    const state: AuthState = {
      schemaVersion: 2,
      state: "ACTIVE",
      revision: 0,
      administratorUserId: "test-administrator",
      sessionEpoch: 0,
      passkeys: [credential],
      recoveryCodeHashes: ["a".repeat(64)],
      revokedSessionHashes: [],
    };
    await writeState(state);

    const preAuthentication = createPreAuthentication(state);
    const ceremony: CeremonyClaims = {
      typ: "ceremony-v1",
      purpose: "login",
      challenge: base64url(randomBytes(32)),
      jti: base64url(randomBytes(32)),
      boundSessionHash: ceremonyBinding(preAuthentication.sid),
      administrator: "administrator",
      recordRevision: state.revision,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const cookieCarrier = new NextResponse();
    setPreAuthenticationCookie(cookieCarrier, preAuthentication);
    setCeremony(cookieCarrier, ceremony);
    const csrfToken = issueCsrf(cookieCarrier, preAuthentication.sid);
    const cookie = cookiesFrom(cookieCarrier);
    const assertion = {
      response: {
        id: credential.id,
        rawId: credential.id,
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: {
          authenticatorData: "AA",
          clientDataJSON: "AA",
          signature: "AA",
        },
      },
    };

    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 0 },
    });

    const first = await verifyWebAuthn(
      postRequest("/api/admin/auth/webauthn/verify", assertion, cookie, csrfToken),
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true, authenticated: true });
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledTimes(1);
    const fullSession = openToken<SessionClaims>(first.cookies.get(cookieNames.session)?.value);
    expect(fullSession).toMatchObject({
      typ: "session-v1",
      administrator: "administrator",
      epoch: state.sessionEpoch,
    });
    expect(fullSession?.sid).not.toBe(preAuthentication.sid);
    expect(first.cookies.get(cookieNames.preAuth)?.value ?? "").toBe("");

    const replay = await verifyWebAuthn(
      postRequest("/api/admin/auth/webauthn/verify", assertion, cookie, csrfToken),
    );
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledTimes(1);
  });

  it("consumes a recovery code once and rejects reuse of the same pending proof", async () => {
    const consumedRecoveryHash = recoveryCodeHash("ABCDE-FGHIJ-KLMNP-QRSTU-VWXYZ-A");
    const state: AuthState = {
      schemaVersion: 2,
      state: "RECOVERY",
      revision: 0,
      administratorUserId: "test-administrator",
      sessionEpoch: 3,
      passkeys: [passkey("Lost passkey")],
      recoveryCodeHashes: [consumedRecoveryHash],
      revokedSessionHashes: [],
    };
    await writeState(state);

    const proof = createRecoveryProof(state, consumedRecoveryHash);
    const replacement = passkey("Replacement passkey");
    const cookieCarrier = new NextResponse();
    setPendingRecovery(cookieCarrier, proof, replacement);
    const csrfToken = issueCsrf(cookieCarrier, proof.sid);
    const cookie = cookiesFrom(cookieCarrier);

    const first = await finalizeRecovery(
      postRequest("/api/admin/auth/recovery/finalize", {}, cookie, csrfToken),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      ok: boolean;
      authenticated: boolean;
      recoveryCodes: string[];
    };
    expect(firstBody).toMatchObject({ ok: true, authenticated: false });
    expect(firstBody.recoveryCodes).toHaveLength(10);

    const afterFirst = JSON.parse(await readFile(statePath, "utf8")) as { auth: AuthState };
    expect(afterFirst.auth.sessionEpoch).toBeGreaterThan(state.sessionEpoch);
    expect(afterFirst.auth.passkeys.map((candidate) => candidate.id)).toEqual([replacement.id]);
    expect(afterFirst.auth.recoveryCodeHashes).not.toContain(consumedRecoveryHash);

    const replay = await finalizeRecovery(
      postRequest("/api/admin/auth/recovery/finalize", {}, cookie, csrfToken),
    );
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });

    const afterReplay = JSON.parse(await readFile(statePath, "utf8")) as { auth: AuthState };
    expect(afterReplay.auth).toEqual(afterFirst.auth);
  });
});
