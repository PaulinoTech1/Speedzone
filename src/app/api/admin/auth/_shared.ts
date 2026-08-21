import "server-only";

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  administratorIdentifierSchema,
  administratorPasswordSchema,
  passkeyRecordSchema,
  type AuthState,
  type BootstrapPreAuthClaims,
  type PasskeyRecord,
  type PreAuthClaims,
  type RecoveryClaims,
  type SessionClaims,
} from "@/lib/domain/auth";
import {
  authorizeSession,
  readBootstrapPreAuthentication,
  hasValidStepUp,
  readPreAuthentication,
  setSessionCookie,
  createSession,
} from "@/lib/server/auth/session";
import { clearAuthenticationCookies, clearHostCookie, cookieNames, setHostCookie } from "@/lib/server/cookies";
import { issueCsrf } from "@/lib/server/csrf";
import { base64url, hmacSha256, randomToken } from "@/lib/server/crypto";
import { adminConfig, tokenConfig } from "@/lib/server/env";
import { progressiveFailureDelay } from "@/lib/server/rate-limit";
import { genericAuthFailure, noStoreJson, RequestValidationError } from "@/lib/server/request";
import { actorSecurityHash, clientSecurityHash, logSecurityEvent, type SecurityEventName } from "@/lib/server/security-log";
import { openToken, sealToken } from "@/lib/server/token";

export const administratorSchema = administratorIdentifierSchema;
export const passwordSchema = administratorPasswordSchema;
export const labelSchema = z.string().trim().min(1).max(80);

const extensionResultsSchema = z.record(z.string(), z.unknown());

const authenticationResponseSchema = z
  .object({
    id: z.string().min(1).max(4096),
    rawId: z.string().min(1).max(4096),
    response: z
      .object({
        authenticatorData: z.string().min(1).max(32_768),
        clientDataJSON: z.string().min(1).max(32_768),
        signature: z.string().min(1).max(32_768),
        userHandle: z.string().max(4096).nullable().optional(),
      })
      .passthrough(),
    type: z.literal("public-key"),
    clientExtensionResults: extensionResultsSchema,
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).nullable().optional(),
  })
  .passthrough();

const registrationResponseSchema = z
  .object({
    id: z.string().min(1).max(4096),
    rawId: z.string().min(1).max(4096),
    response: z
      .object({
        attestationObject: z.string().min(1).max(65_536),
        clientDataJSON: z.string().min(1).max(32_768),
        transports: z.array(z.string().max(32)).max(8).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: z.string().max(65_536).optional(),
        authenticatorData: z.string().max(65_536).optional(),
      })
      .passthrough(),
    type: z.literal("public-key"),
    clientExtensionResults: extensionResultsSchema,
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).nullable().optional(),
  })
  .passthrough();

export const authenticationBodySchema = z
  .object({ response: authenticationResponseSchema })
  .strict();

export const registrationBodySchema = z
  .object({ response: registrationResponseSchema })
  .strict();

export function authenticationResponse(
  body: z.infer<typeof authenticationBodySchema>,
): AuthenticationResponseJSON {
  return body.response as AuthenticationResponseJSON;
}

export function registrationResponse(
  body: z.infer<typeof registrationBodySchema>,
): RegistrationResponseJSON {
  return body.response as RegistrationResponseJSON;
}

export class AuthenticationFlowError extends Error {
  constructor() {
    super("Authentication failed");
  }
}

type FailureCounter = { count: number; lastFailureAt: number };
type FailureMap = Map<string, FailureCounter>;
const failureGlobal = globalThis as typeof globalThis & { __speedzoneAuthFailures?: FailureMap };
const failures = (failureGlobal.__speedzoneAuthFailures ??= new Map());
const failureWindowMs = 15 * 60_000;

function failureKey(request: NextRequest): string {
  return `${clientSecurityHash(request)}:${actorSecurityHash("administrator")}`;
}

export async function authenticationFailureResponse(
  request: NextRequest,
  event: Extract<SecurityEventName, "auth.password" | "auth.passkey" | "auth.bootstrap" | "auth.recovery">,
  reason = "invalid_authentication",
): Promise<NextResponse> {
  const now = Date.now();
  const key = failureKey(request);
  const previous = failures.get(key);
  const count = previous && now - previous.lastFailureAt <= failureWindowMs ? previous.count + 1 : 1;
  failures.set(key, { count, lastFailureAt: now });
  for (const [candidate, record] of failures) {
    if (now - record.lastFailureAt > failureWindowMs) failures.delete(candidate);
  }
  logSecurityEvent({
    event,
    outcome: "failure",
    actorHash: actorSecurityHash("administrator"),
    clientHash: clientSecurityHash(request),
    reason,
  });
  await progressiveFailureDelay(count);
  const response = genericAuthFailure();
  clearHostCookie(response, cookieNames.ceremony);
  return response;
}

export function clearAuthenticationFailures(request: NextRequest): void {
  failures.delete(failureKey(request));
}

export function logAuthenticationSuccess(
  request: NextRequest,
  event: Extract<SecurityEventName, "auth.password" | "auth.passkey" | "auth.bootstrap" | "auth.recovery">,
): void {
  logSecurityEvent({
    event,
    outcome: "success",
    actorHash: actorSecurityHash(adminConfig().identifier),
    clientHash: clientSecurityHash(request),
  });
}

export function logManagementSuccess(
  request: NextRequest,
  event: Extract<SecurityEventName, "auth.logout" | "auth.session_revoked" | "passkey.added" | "passkey.deleted">,
  recordId?: string,
): void {
  logSecurityEvent({
    event,
    outcome: "success",
    actorHash: actorSecurityHash(adminConfig().identifier),
    clientHash: clientSecurityHash(request),
    recordId: recordId
      ? hmacSha256(tokenConfig().hashKey, `security-record:${recordId}`).slice(0, 20)
      : undefined,
  });
}

export function requireActivePreAuthentication(
  request: NextRequest,
  state: AuthState,
): PreAuthClaims {
  const claims = readPreAuthentication(request, state);
  if (!claims || adminConfig().disabled) throw new AuthenticationFlowError();
  return claims;
}

export function requireBootstrapPreAuthentication(
  request: NextRequest,
  state: AuthState,
): BootstrapPreAuthClaims {
  const claims = readBootstrapPreAuthentication(request, state);
  if (!claims || adminConfig().disabled || state.state !== "BOOTSTRAP_READY") {
    throw new AuthenticationFlowError();
  }
  return claims;
}

export function requireFreshStepUp(request: NextRequest, session: SessionClaims): void {
  if (!hasValidStepUp(request, session)) {
    throw new RequestValidationError("Fresh passkey verification required", 403, "STEP_UP_REQUIRED");
  }
}

export async function requireEnabledAdministrator(request: NextRequest) {
  const authorized = await authorizeSession(request);
  if (!authorized || adminConfig().disabled) {
    throw new RequestValidationError("Authentication required", 401, "AUTH_REQUIRED");
  }
  return authorized;
}

export function successfulSessionResponse(
  state: AuthState,
  body: Record<string, unknown> = {},
): NextResponse {
  const claims = createSession(state);
  const response = noStoreJson({ ok: true, authenticated: true, ...body, csrfToken: "pending" });
  clearAuthenticationCookies(response);
  setSessionCookie(response, claims);
  const csrfToken = issueCsrf(response, claims.sid);
  const finalResponse = noStoreJson({ ok: true, authenticated: true, ...body, csrfToken });
  for (const cookie of response.cookies.getAll()) finalResponse.cookies.set(cookie);
  return finalResponse;
}

export function clearCeremony(response: NextResponse): void {
  clearHostCookie(response, cookieNames.ceremony);
}

export function stableAdministratorUserId(): string {
  const administrator = adminConfig().identifier;
  const hex = hmacSha256(tokenConfig().hashKey, `webauthn-user:${administrator}`);
  return base64url(Buffer.from(hex, "hex"));
}

type RecoveryProofClaims = RecoveryClaims & { epoch: number; recordRevision: number };

type PendingRecoveryClaims = {
  typ: "recovery-pending-v1";
  sid: string;
  administrator: string;
  recoveryCodeHash: string;
  passkey: PasskeyRecord;
  epoch: number;
  recordRevision: number;
  issuedAt: number;
  expiresAt: number;
};

const recoveryLifetimeSeconds = 5 * 60;

export function createRecoveryProof(state: AuthState, recoveryCodeHash: string, now = Date.now()): RecoveryProofClaims {
  if (state.state !== "RECOVERY") throw new AuthenticationFlowError();
  return {
    typ: "recovery-v1",
    sid: randomToken(32),
    administrator: adminConfig().identifier,
    recoveryCodeHash,
    epoch: state.sessionEpoch,
    recordRevision: state.revision,
    issuedAt: now,
    expiresAt: now + recoveryLifetimeSeconds * 1000,
  };
}

export function setRecoveryProof(response: NextResponse, claims: RecoveryProofClaims): void {
  setHostCookie(response, cookieNames.recovery, sealToken(claims), recoveryLifetimeSeconds);
}

export function readRecoveryProof(
  request: NextRequest,
  state: AuthState,
  now = Date.now(),
): RecoveryProofClaims | null {
  const claims = openToken<RecoveryProofClaims>(request.cookies.get(cookieNames.recovery)?.value);
  if (
    !claims ||
    claims.typ !== "recovery-v1" ||
    claims.issuedAt > now ||
    claims.expiresAt <= now ||
    claims.epoch !== state.sessionEpoch ||
    claims.recordRevision !== state.revision ||
    state.state !== "RECOVERY" ||
    claims.administrator !== adminConfig().identifier ||
    !state.recoveryCodeHashes.includes(claims.recoveryCodeHash)
  ) {
    return null;
  }
  return claims;
}

export function setPendingRecovery(
  response: NextResponse,
  proof: RecoveryProofClaims,
  passkey: PasskeyRecord,
  now = Date.now(),
): void {
  const claims: PendingRecoveryClaims = {
    typ: "recovery-pending-v1",
    sid: proof.sid,
    administrator: proof.administrator,
    recoveryCodeHash: proof.recoveryCodeHash,
    passkey,
    epoch: proof.epoch,
    recordRevision: proof.recordRevision,
    issuedAt: now,
    expiresAt: Math.min(proof.expiresAt, now + recoveryLifetimeSeconds * 1000),
  };
  const remaining = Math.max(1, Math.floor((claims.expiresAt - now) / 1000));
  setHostCookie(response, cookieNames.recovery, sealToken(claims), remaining);
}

export function readPendingRecovery(
  request: NextRequest,
  state: AuthState,
  now = Date.now(),
): PendingRecoveryClaims | null {
  const claims = openToken<PendingRecoveryClaims>(request.cookies.get(cookieNames.recovery)?.value);
  const parsedPasskey = passkeyRecordSchema.safeParse(claims?.passkey);
  if (
    !claims ||
    claims.typ !== "recovery-pending-v1" ||
    claims.issuedAt > now ||
    claims.expiresAt <= now ||
    claims.epoch !== state.sessionEpoch ||
    claims.recordRevision !== state.revision ||
    state.state !== "RECOVERY" ||
    claims.administrator !== adminConfig().identifier ||
    !state.recoveryCodeHashes.includes(claims.recoveryCodeHash) ||
    !parsedPasskey.success
  ) {
    return null;
  }
  return { ...claims, passkey: parsedPasskey.data };
}
