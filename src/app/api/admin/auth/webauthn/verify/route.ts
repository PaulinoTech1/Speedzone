import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationBodySchema,
  authenticationFailureResponse,
  authenticationResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
  requireActivePreAuthentication,
  successfulSessionResponse,
} from "@/app/api/admin/auth/_shared";
import {
  burnCeremony,
  readCeremony,
  verifyAuthentication,
} from "@/lib/server/auth/webauthn";
import { assertCsrf } from "@/lib/server/csrf";
import { assertAllowedOrigin, parseJsonBody } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { mutateAuthState, readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    await enforceClientRateLimit(request, "webauthn");
    const state = await readAuthState();
    const preAuthentication = requireActivePreAuthentication(request, state);
    assertCsrf(request, preAuthentication.sid);
    const body = await parseJsonBody(request, authenticationBodySchema, 96 * 1024);
    const ceremony = readCeremony(request, "login", preAuthentication.sid, state);
    if (!ceremony || !(await burnCeremony(ceremony))) throw new AuthenticationFlowError();

    let verified: Awaited<ReturnType<typeof verifyAuthentication>>;
    try {
      verified = await verifyAuthentication(authenticationResponse(body), ceremony, state);
    } catch {
      throw new AuthenticationFlowError();
    }

    const verifiedCredential = state.passkeys.find(
      (passkey) => passkey.id === verified.credentialId,
    );
    if (!verifiedCredential) throw new AuthenticationFlowError();
    const nextState =
      verifiedCredential.counter === verified.newCounter
        ? state
        : await mutateAuthState(
            (current) => {
              if (!current.passkeys.some((passkey) => passkey.id === verified.credentialId)) {
                throw new AuthenticationFlowError();
              }
              return {
                ...current,
                passkeys: current.passkeys.map((passkey) =>
                  passkey.id === verified.credentialId
                    ? { ...passkey, counter: verified.newCounter }
                    : passkey,
                ),
              };
            },
            state.revision,
          );

    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.passkey");
    return successfulSessionResponse(nextState);
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.passkey");
    }
    return routeError(error);
  }
}
