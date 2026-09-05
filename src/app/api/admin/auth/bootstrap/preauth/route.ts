import { NextRequest } from "next/server";
import { z } from "zod";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
} from "@/app/api/admin/auth/_shared";
import {
  administratorIdentifierSchema,
  administratorPasswordSchema,
} from "@/lib/domain/auth";
import { verifyAdministrator } from "@/lib/server/auth/password";
import {
  createBootstrapPreAuthentication,
  readBootstrapPreAuthentication,
  readPreAuthentication,
  setBootstrapPreAuthenticationCookie,
} from "@/lib/server/auth/session";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { constantTimeTextEqual, sha256 } from "@/lib/server/crypto";
import { assertCsrf, issueCsrf } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import {
  assertBootstrapEnrollmentRequest,
  noStoreJson,
  parseStrictJsonBody,
} from "@/lib/server/request";
import { enforceBootstrapRateLimit, routeError } from "@/lib/server/route-utils";
import { StateConfigurationError, readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapTokenSchema = z.string().superRefine((token, context) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    context.addIssue({ code: "custom", message: "Bootstrap token is invalid" });
    return;
  }
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== token) {
    context.addIssue({ code: "custom", message: "Bootstrap token is invalid" });
  }
});

const bodySchema = z
  .object({
    adminId: administratorIdentifierSchema,
    password: administratorPasswordSchema,
    bootstrapToken: bootstrapTokenSchema,
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    assertBootstrapEnrollmentRequest(request);
    const state = await readAuthState();
    const existingBootstrap = readBootstrapPreAuthentication(request, state);
    const existingLogin = readPreAuthentication(request, state);
    assertCsrf(request, existingBootstrap?.sid ?? existingLogin?.sid ?? "anonymous");
    await enforceBootstrapRateLimit(request);

    if (state.state !== "BOOTSTRAP_READY") {
      return noStoreJson(
        { ok: false, error: { code: "NOT_FOUND", message: "Not found" } },
        { status: 404 },
      );
    }
    const configuredTokenHash = adminConfig().bootstrapTokenHash;
    if (!configuredTokenHash) {
      throw new StateConfigurationError("Bootstrap credential is not configured");
    }

    const body = await parseStrictJsonBody(request, bodySchema, 4 * 1024);
    const passwordValid = await verifyAdministrator(body.adminId, body.password);
    const tokenValid = constantTimeTextEqual(sha256(body.bootstrapToken), configuredTokenHash);
    if (!passwordValid || !tokenValid) throw new AuthenticationFlowError();

    const claims = createBootstrapPreAuthentication(state);
    const cookieResponse = noStoreJson({ ok: true, bootstrapAuthorized: true, csrfToken: "pending" });
    clearAuthenticationCookies(cookieResponse);
    setBootstrapPreAuthenticationCookie(cookieResponse, claims);
    const csrfToken = issueCsrf(cookieResponse, claims.sid);
    const response = noStoreJson({ ok: true, bootstrapAuthorized: true, csrfToken });
    for (const cookie of cookieResponse.cookies.getAll()) response.cookies.set(cookie);

    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.bootstrap");
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      const failure = await authenticationFailureResponse(request, "auth.bootstrap");
      clearAuthenticationCookies(failure);
      return failure;
    }
    return routeError(error);
  }
}
