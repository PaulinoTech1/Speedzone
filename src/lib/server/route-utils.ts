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
  clientSecurityHash,
  ipSecurityHash,
  ja4SecurityHash,
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

export function enforceRateLimit(
  request: NextRequest,
  policy: RatePolicyName,
  subject: string,
): void {
  const client = clientSecurityHash(request);
  const byClient = checkRateLimit(policy, `client:${client}`);
  const bySubject = checkRateLimit(policy, `subject:${subject}`);
  const denied = !byClient.allowed ? byClient : !bySubject.allowed ? bySubject : null;
  if (denied && !denied.allowed) {
    logSecurityEvent({ event: "rate_limited", outcome: "blocked", clientHash: client, reason: policy });
    throw new RateLimitError(denied.retryAfter);
  }
}

export function enforceClientRateLimit(
  request: NextRequest,
  policy: RatePolicyName,
): void {
  const client = clientSecurityHash(request);
  const result = checkRateLimit(policy, `client:${client}`);
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

export function enforceBootstrapRateLimit(request: NextRequest): void {
  const client = clientSecurityHash(request);
  const keys = [`ip:${ipSecurityHash(request)}`];
  const ja4 = ja4SecurityHash(request);
  if (ja4) keys.push(`ja4:${ja4}`);
  let denied: { allowed: false; retryAfter: number } | null = null;
  for (const key of keys) {
    const result = checkRateLimit("bootstrap", key);
    if (!result.allowed && !denied) denied = result;
  }
  if (denied) {
    logSecurityEvent({
      event: "rate_limited",
      outcome: "blocked",
      clientHash: client,
      reason: "bootstrap",
    });
    throw new RateLimitError(denied.retryAfter);
  }
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
    return noStoreJson(
      { ok: false, error: { code: "SERVICE_NOT_CONFIGURED", message: "Storage is not configured" } },
      { status: 503 },
    );
  }
  // Keep unexpected values out of logs: upstream errors can contain request or
  // provider details. Operators get the route/status from platform telemetry.
  console.error("Administrative request failed");
  return noStoreJson(
    { ok: false, error: { code: "SERVER_ERROR", message: "The request could not be completed" } },
    { status: 500 },
  );
}
