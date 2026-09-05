import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  requireActivePreAuthentication,
} from "@/app/api/admin/auth/_shared";
import { authenticationOptions, setCeremony } from "@/lib/server/auth/webauthn";
import { assertCsrf } from "@/lib/server/csrf";
import { assertAllowedOrigin, noStoreJson } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    await enforceClientRateLimit(request, "webauthn");
    const state = await readAuthState();
    const preAuthentication = requireActivePreAuthentication(request, state);
    assertCsrf(request, preAuthentication.sid);
    if (!state.passkeys.length) throw new AuthenticationFlowError();

    const { options, ceremony } = await authenticationOptions(state, "login", preAuthentication.sid);
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
