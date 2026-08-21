import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationBodySchema,
  authenticationFailureResponse,
  authenticationResponse,
  clearAuthenticationFailures,
  clearCeremony,
  logAuthenticationSuccess,
  requireEnabledAdministrator,
} from "@/app/api/admin/auth/_shared";
import {
  clearPasswordStepUp,
  hasValidPasswordStepUp,
  issueStepUp,
  refreshSession,
  sessionDigest,
} from "@/lib/server/auth/session";
import { burnCeremony, readCeremony, verifyAuthentication } from "@/lib/server/auth/webauthn";
import { noStoreJson, parseJsonBody } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";
import { mutateAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    if (!hasValidPasswordStepUp(request, claims)) throw new AuthenticationFlowError();
    enforceRateLimit(request, "webauthn", `step-up:${sessionDigest(claims.sid)}`);
    const body = await parseJsonBody(request, authenticationBodySchema, 96 * 1024);
    const ceremony = readCeremony(request, "step-up", claims.sid, state);
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
    if (verifiedCredential.counter !== verified.newCounter) {
      await mutateAuthState(
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
    }

    const response = noStoreJson({ ok: true, stepUp: true });
    clearCeremony(response);
    clearPasswordStepUp(response);
    issueStepUp(response, claims);
    refreshSession(response, claims);
    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.passkey");
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.passkey");
    }
    return routeError(error);
  }
}
