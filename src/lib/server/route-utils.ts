import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import type { SessionClaims } from "@/lib/domain/auth";
import { InventoryValidationError } from "@/lib/server/inventory";
import { checkRateLimit, type RatePolicyName } from "@/lib/server/rate-limit";
import {
  assertAllowedOrigin,
  noStoreJson,
  RequestValidationError,
} from "@/lib/server/request";
import {
  ipSecurityHash,
  logSecurityEvent,
} from "@/lib/server/security-log";
import { authorizeSession } from "@/lib/server/auth/session";
import { assertCsrf } from "@/lib/server/csrf";
import { StateConflictError, StateConfigurationError } from "@/lib/server/storage/state";

export class RateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Rate limit exceeded");
  }
}

export async function requireAdmin(request: NextRequest) {
  const authorized = await authorizeSession(request);
  if (!authorized) throw new RequestValidationError("Authentication required", 401, "AUTH_REQUIRED");
  return authorized;
}

export function assertAdminMutation(request: NextRequest, session: SessionClaims): void {
  assertAllowedOrigin(request);
  assertCsrf(request, session.sid);
}

export async function enforceRateLimit(
  request: NextRequest,
  policy: RatePolicyName,
  subject: string,
): Promise<void> {
  // The subject must come from validated authentication, never a global login label.
  await enforceClientRateLimit(request, policy);
  const client = ipSecurityHash(request);
  const bySubject = await checkRateLimit(policy, `subject:${subject}`);
  const denied = !bySubject.allowed ? bySubject : null;
  if (denied && !denied.allowed) {
    logSecurityEvent({ event: "rate_limited", outcome: "blocked", clientHash: client, reason: policy });
    throw new RateLimitError(denied.retryAfter);
  }
}

export async function enforceClientRateLimit(
  request: NextRequest,
  policy: RatePolicyName,
): Promise<void> {
  const client = ipSecurityHash(request);
  const result = await checkRateLimit(policy, `client:${client}`);
  if (!result.allowed) {
    logSecurityEvent({
      event: "rate_limited",
      outcome: "blocked",
      clientHash: client,
      reason: policy,
    });
    throw new RateLimitError(result.retryAfter);
  }
}

export async function enforceBootstrapRateLimit(request: NextRequest): Promise<void> {
  // JA4 is shared by unrelated browsers; it is telemetry, not a lockout key.
  await enforceClientRateLimit(request, "bootstrap");
}

export function routeError(error: unknown): NextResponse {
  if (error instanceof RateLimitError) {
    const response = noStoreJson(
      { ok: false, error: { code: "RATE_LIMITED", message: "Request limit reached" } },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  if (error instanceof RequestValidationError) {
    return noStoreJson(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof StateConflictError) {
    return noStoreJson(
      { ok: false, error: { code: "CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof InventoryValidationError) {
    const status = error.code === "NOT_FOUND" ? 404 : 422;
    return noStoreJson(
      { ok: false, error: { code: error.code, message: error.message } },
      { status },
    );
  }
  if (error instanceof ZodError) {
    return noStoreJson(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Request validation failed" } },
      { status: 422 },
    );
  }
  if (error instanceof StateConfigurationError) {
    // Configuration failures are intentionally generic to the browser, but
    // operators still need a safe reason in protected platform logs. Every
    // StateConfigurationError message is application-controlled and must never
    // include credentials, connection strings, request bodies, or provider
    // response payloads.
    console.error(`Service configuration error: ${error.message}`);
    return noStoreJson(
      { ok: false, error: { code: "SERVICE_NOT_CONFIGURED", message: "Storage is not configured" } },
      { status: 503 },
    );
  }
  // Keep unexpected values out of logs: upstream errors can contain request or
  // provider details. Operators get the route/status from platform telemetry.
  console.error("Request failed");
  return noStoreJson(
    { ok: false, error: { code: "SERVER_ERROR", message: "The request could not be completed" } },
    { status: 500 },
  );
}
