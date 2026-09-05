import { NextRequest } from "next/server";

import {
  authenticationFailureResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
  requireEnabledAdministrator,
} from "@/app/api/admin/auth/_shared";
import { passwordAuthenticationBodySchema } from "@/lib/domain/auth";
import { verifyAdministrator } from "@/lib/server/auth/password";
import { issuePasswordStepUp, sessionDigest } from "@/lib/server/auth/session";
import { clearHostCookie, cookieNames } from "@/lib/server/cookies";
import { noStoreJson, parseStrictJsonBody } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    await enforceRateLimit(request, "password", `step-up:${sessionDigest(claims.sid)}`);
    const body = await parseStrictJsonBody(request, passwordAuthenticationBodySchema, 4 * 1024);
    if (state.state !== "ACTIVE" || !(await verifyAdministrator(body.adminId, body.password))) {
      const failure = await authenticationFailureResponse(request, "auth.password");
      clearHostCookie(failure, cookieNames.passwordStepUp);
      clearHostCookie(failure, cookieNames.stepUp);
      return failure;
    }

    const response = noStoreJson({ ok: true, passwordVerified: true });
    clearHostCookie(response, cookieNames.stepUp);
    issuePasswordStepUp(response, claims);
    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.password");
    return response;
  } catch (error) {
    return routeError(error);
  }
}
