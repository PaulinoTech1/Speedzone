import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
} from "@/app/api/admin/auth/_shared";
import { passwordAuthenticationBodySchema } from "@/lib/domain/auth";
import { createPreAuthentication, setPreAuthenticationCookie } from "@/lib/server/auth/session";
import { verifyAdministrator } from "@/lib/server/auth/password";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { assertCsrf, issueCsrf } from "@/lib/server/csrf";
import { noStoreJson, assertAllowedOrigin, parseStrictJsonBody } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumPasswordRequestBytes = 4 * 1024;

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    assertCsrf(request, "anonymous");
    await enforceClientRateLimit(request, "password");
    const body = await parseStrictJsonBody(
      request,
      passwordAuthenticationBodySchema,
      maximumPasswordRequestBytes,
    );
    if (!(await verifyAdministrator(body.adminId, body.password))) {
      return authenticationFailureResponse(request, "auth.password");
    }

    const state = await readAuthState();
    if (state.state !== "ACTIVE" || !state.passkeys.length) {
      throw new AuthenticationFlowError();
    }
    const preAuthentication = createPreAuthentication(state);
    const authenticationStep = "passkey";
    const cookieResponse = noStoreJson({ ok: true, authenticationStep, csrfToken: "pending" });
    clearAuthenticationCookies(cookieResponse);
    setPreAuthenticationCookie(cookieResponse, preAuthentication);
    const csrfToken = issueCsrf(cookieResponse, preAuthentication.sid);
    const response = noStoreJson({ ok: true, authenticationStep, csrfToken });
    for (const cookie of cookieResponse.cookies.getAll()) response.cookies.set(cookie);

    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.password");
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.password");
    }
    return routeError(error);
  }
}
