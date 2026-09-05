import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { emptyAuthState, type AuthState, type SessionClaims } from "@/lib/domain/auth";
import {
  createPreAuthentication,
  createSession,
  sessionDigest,
  validateSessionClaims,
} from "@/lib/server/auth/session";
import { cookieNames } from "@/lib/server/cookies";
import { assertCsrf, issueCsrf } from "@/lib/server/csrf";
import { checkRateLimit } from "@/lib/server/rate-limit";

function activeState(): AuthState {
  return {
    ...emptyAuthState(),
    state: "ACTIVE",
    administratorUserId: "session-test-administrator",
    passkeys: [
      {
        id: "session-test-passkey",
        publicKey: "AQID",
        counter: 0,
        transports: ["internal"],
        createdAt: "2026-08-21T12:00:00.000Z",
        label: "Session test passkey",
      },
    ],
    recoveryCodeHashes: ["a".repeat(64)],
  };
}

describe("session boundaries", () => {
  it("never treats password pre-authentication as a complete session", () => {
    const state = activeState();
    const preAuth = createPreAuthentication(state, 10_000);
    expect((preAuth as { typ: string }).typ).toBe("preauth-v1");
    expect(validateSessionClaims(preAuth as unknown as SessionClaims, state, 10_001)).toBe(false);
  });

  it("enforces idle and absolute expiration and global revocation", () => {
    const now = 100_000;
    const state = activeState();
    const claims = createSession(state, now);
    expect(validateSessionClaims(claims, state, now + 14 * 60_000)).toBe(true);
    expect(validateSessionClaims(claims, state, now + 15 * 60_000 + 1)).toBe(false);
    expect(validateSessionClaims(claims, state, now + 8 * 60 * 60_000)).toBe(false);
    expect(
      validateSessionClaims(claims, { ...state, sessionEpoch: state.sessionEpoch + 1 }, now + 1),
    ).toBe(false);
    expect(
      validateSessionClaims(
        claims,
        { ...state, revokedSessionHashes: [sessionDigest(claims.sid)] },
        now + 1,
      ),
    ).toBe(false);
    process.env.ADMIN_DISABLED = "true";
    expect(validateSessionClaims(claims, state, now + 1)).toBe(false);
    process.env.ADMIN_DISABLED = "false";
  });
});

describe("CSRF and rate limiting", () => {
  it("requires the sealed cookie, matching in-memory header, and binding", () => {
    const response = new NextResponse();
    const token = issueCsrf(response, "session-1", 1_000);
    const cookie = response.cookies.get(cookieNames.csrf);
    expect(cookie).toBeDefined();
    const request = new NextRequest("http://localhost:4173/api/admin/example", {
      method: "POST",
      headers: {
        cookie: `${cookieNames.csrf}=${cookie?.value}`,
        "x-csrf-token": token,
      },
    });
    expect(() => assertCsrf(request, "session-1", 1_001)).not.toThrow();
    expect(() => assertCsrf(request, "different-session", 1_001)).toThrow();
  });

  it("blocks after the configured password-attempt limit", async () => {
    const key = `vitest-${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await checkRateLimit("password", key, 10_000)).allowed).toBe(true);
    }
    const denied = await checkRateLimit("password", key, 10_000);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfter).toBeGreaterThan(0);
  });
});
