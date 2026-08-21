import "server-only";

import { NextRequest, NextResponse } from "next/server";

import type {
  AuthState,
  BootstrapPreAuthClaims,
  PasswordStepUpClaims,
  PreAuthClaims,
  SessionClaims,
  StepUpClaims,
} from "@/lib/domain/auth";
import { cookieNames, clearHostCookie, setHostCookie } from "@/lib/server/cookies";
import { hmacSha256, randomToken } from "@/lib/server/crypto";
import { adminConfig, tokenConfig } from "@/lib/server/env";
import { readAuthState } from "@/lib/server/storage/state";
import { consumeOnce } from "@/lib/server/storage/consume-once";
import { openToken, sealToken } from "@/lib/server/token";

const preAuthLifetimeSeconds = 5 * 60;
const bootstrapPreAuthLifetimeSeconds = 5 * 60;
const idleLifetimeMs = 15 * 60_000;
const absoluteLifetimeMs = 8 * 60 * 60_000;
const stepUpLifetimeSeconds = 5 * 60;

export function sessionDigest(sessionId: string): string {
  return hmacSha256(tokenConfig().hashKey, `session:${sessionId}`);
}

export function createPreAuthentication(state: AuthState, now = Date.now()): PreAuthClaims {
  if (state.state !== "ACTIVE") throw new Error("Authentication state is not active");
  return {
    typ: "preauth-v1",
    sid: randomToken(32),
    administrator: adminConfig().identifier,
    epoch: state.sessionEpoch,
    issuedAt: now,
    expiresAt: now + preAuthLifetimeSeconds * 1000,
  };
}

export function createBootstrapPreAuthentication(
  state: AuthState,
  now = Date.now(),
): BootstrapPreAuthClaims {
  if (state.state !== "BOOTSTRAP_READY") {
    throw new Error("Bootstrap is not available");
  }
  return {
    typ: "bootstrap-preauth-v1",
    sid: randomToken(32),
    administrator: adminConfig().identifier,
    epoch: state.sessionEpoch,
    recordRevision: state.revision,
    issuedAt: now,
    expiresAt: now + bootstrapPreAuthLifetimeSeconds * 1000,
  };
}

export function setBootstrapPreAuthenticationCookie(
  response: NextResponse,
  claims: BootstrapPreAuthClaims,
): void {
  setHostCookie(
    response,
    cookieNames.bootstrap,
    sealToken(claims),
    bootstrapPreAuthLifetimeSeconds,
  );
}

export function readBootstrapPreAuthentication(
  request: NextRequest,
  state: AuthState,
  now = Date.now(),
): BootstrapPreAuthClaims | null {
  const claims = openToken<BootstrapPreAuthClaims>(
    request.cookies.get(cookieNames.bootstrap)?.value,
  );
  if (
    !claims ||
    claims.typ !== "bootstrap-preauth-v1" ||
    claims.expiresAt <= now ||
    claims.issuedAt > now ||
    claims.epoch !== state.sessionEpoch ||
    claims.recordRevision !== state.revision ||
    claims.administrator !== adminConfig().identifier ||
    state.state !== "BOOTSTRAP_READY"
  ) {
    return null;
  }
  return claims;
}

export function setPreAuthenticationCookie(response: NextResponse, claims: PreAuthClaims): void {
  setHostCookie(response, cookieNames.preAuth, sealToken(claims), preAuthLifetimeSeconds);
}

export function readPreAuthentication(
  request: NextRequest,
  state: AuthState,
  now = Date.now(),
): PreAuthClaims | null {
  const claims = openToken<PreAuthClaims>(request.cookies.get(cookieNames.preAuth)?.value);
  if (
    !claims ||
    claims.typ !== "preauth-v1" ||
    state.state !== "ACTIVE" ||
    claims.expiresAt <= now ||
    claims.issuedAt > now ||
    claims.epoch !== state.sessionEpoch ||
    claims.administrator !== adminConfig().identifier
  ) {
    return null;
  }
  return claims;
}

export function createSession(state: AuthState, now = Date.now()): SessionClaims {
  if (state.state !== "ACTIVE") throw new Error("Authentication state is not active");
  return {
    typ: "session-v1",
    sid: randomToken(32),
    administrator: adminConfig().identifier,
    epoch: state.sessionEpoch,
    issuedAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + absoluteLifetimeMs,
  };
}

export function setSessionCookie(response: NextResponse, claims: SessionClaims, now = Date.now()): void {
  const remainingSeconds = Math.max(0, Math.floor((claims.absoluteExpiresAt - now) / 1000));
  setHostCookie(response, cookieNames.session, sealToken(claims), remainingSeconds);
}

export function validateSessionClaims(
  claims: SessionClaims | null,
  state: AuthState,
  now = Date.now(),
): claims is SessionClaims {
  return Boolean(
    claims &&
      claims.typ === "session-v1" &&
      state.state === "ACTIVE" &&
      claims.issuedAt <= now &&
      claims.lastSeenAt <= now &&
      claims.absoluteExpiresAt > now &&
      now - claims.lastSeenAt <= idleLifetimeMs &&
      claims.epoch === state.sessionEpoch &&
      claims.administrator === adminConfig().identifier &&
      !adminConfig().disabled &&
      !state.revokedSessionHashes.includes(sessionDigest(claims.sid)),
  );
}

export async function authorizeSession(
  request: NextRequest,
  now = Date.now(),
): Promise<{ claims: SessionClaims; state: AuthState } | null> {
  const state = await readAuthState();
  const claims = openToken<SessionClaims>(request.cookies.get(cookieNames.session)?.value);
  return validateSessionClaims(claims, state, now) ? { claims, state } : null;
}

export function refreshSession(response: NextResponse, claims: SessionClaims, now = Date.now()): void {
  setSessionCookie(response, { ...claims, lastSeenAt: now }, now);
}

export function clearPreAuthentication(response: NextResponse): void {
  clearHostCookie(response, cookieNames.preAuth);
  clearHostCookie(response, cookieNames.ceremony);
  clearHostCookie(response, cookieNames.csrf);
}

export function issueStepUp(response: NextResponse, session: SessionClaims, now = Date.now()): void {
  const claims: StepUpClaims = {
    typ: "stepup-v2",
    sid: session.sid,
    jti: randomToken(32),
    action: "manage-passkeys",
    assurance: "password-and-passkey",
    issuedAt: now,
    expiresAt: now + stepUpLifetimeSeconds * 1000,
  };
  setHostCookie(response, cookieNames.stepUp, sealToken(claims), stepUpLifetimeSeconds);
}

export function issuePasswordStepUp(
  response: NextResponse,
  session: SessionClaims,
  now = Date.now(),
): void {
  const claims: PasswordStepUpClaims = {
    typ: "stepup-password-v1",
    sid: session.sid,
    administrator: session.administrator,
    epoch: session.epoch,
    issuedAt: now,
    expiresAt: now + stepUpLifetimeSeconds * 1000,
  };
  setHostCookie(
    response,
    cookieNames.passwordStepUp,
    sealToken(claims),
    stepUpLifetimeSeconds,
  );
}

export function hasValidPasswordStepUp(
  request: NextRequest,
  session: SessionClaims,
  now = Date.now(),
): boolean {
  const claims = openToken<PasswordStepUpClaims>(
    request.cookies.get(cookieNames.passwordStepUp)?.value,
  );
  return Boolean(
    claims &&
      claims.typ === "stepup-password-v1" &&
      claims.sid === session.sid &&
      claims.administrator === session.administrator &&
      claims.epoch === session.epoch &&
      claims.issuedAt <= now &&
      claims.expiresAt > now,
  );
}

export function clearPasswordStepUp(response: NextResponse): void {
  clearHostCookie(response, cookieNames.passwordStepUp);
}

export function hasValidStepUp(request: NextRequest, session: SessionClaims, now = Date.now()): boolean {
  return readValidStepUp(request, session, now) !== null;
}

function readValidStepUp(
  request: NextRequest,
  session: SessionClaims,
  now = Date.now(),
): StepUpClaims | null {
  const claims = openToken<StepUpClaims>(request.cookies.get(cookieNames.stepUp)?.value);
  return (
    claims &&
      claims.typ === "stepup-v2" &&
      typeof claims.jti === "string" &&
      claims.jti.length >= 43 &&
      claims.action === "manage-passkeys" &&
      claims.assurance === "password-and-passkey" &&
      claims.sid === session.sid &&
      claims.issuedAt <= now &&
      claims.expiresAt > now
  )
    ? claims
    : null;
}

export async function consumeFreshStepUp(
  request: NextRequest,
  session: SessionClaims,
  now = Date.now(),
): Promise<boolean> {
  const claims = readValidStepUp(request, session, now);
  if (!claims) return false;
  const digest = hmacSha256(tokenConfig().hashKey, `stepup:${claims.jti}`);
  return consumeOnce("stepup", digest, claims.expiresAt);
}
