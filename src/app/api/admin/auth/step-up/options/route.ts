import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  requireEnabledAdministrator,
} from "@/app/api/admin/auth/_shared";
import { hasValidPasswordStepUp, sessionDigest } from "@/lib/server/auth/session";
import { authenticationOptions, setCeremony } from "@/lib/server/auth/webauthn";
import { noStoreJson } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    if (!hasValidPasswordStepUp(request, claims)) throw new AuthenticationFlowError();
    await enforceRateLimit(request, "webauthn", `step-up:${sessionDigest(claims.sid)}`);
    if (!state.passkeys.length) throw new AuthenticationFlowError();
    const { options, ceremony } = await authenticationOptions(state, "step-up", claims.sid);
    const response = noStoreJson({ ok: true, options });
    setCeremony(response, ceremony);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.passkey");
    }
    return routeError(error);
  }
}
