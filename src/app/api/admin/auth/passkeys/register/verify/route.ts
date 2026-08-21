import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearCeremony,
  logManagementSuccess,
  registrationBodySchema,
  registrationResponse,
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import {
  consumeFreshStepUp,
  refreshSession,
  sessionDigest,
} from "@/lib/server/auth/session";
import { clearHostCookie, cookieNames } from "@/lib/server/cookies";
import { burnCeremony, readCeremony, verifyRegistration } from "@/lib/server/auth/webauthn";
import { noStoreJson, parseJsonBody } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";
import { mutateAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    requireFreshStepUp(request, claims);
    enforceRateLimit(request, "passkeyManagement", `register:${sessionDigest(claims.sid)}`);
    const body = await parseJsonBody(request, registrationBodySchema, 128 * 1024);
    const ceremony = readCeremony(request, "add-passkey", claims.sid, state);
    if (!ceremony || !(await burnCeremony(ceremony))) throw new AuthenticationFlowError();

    let passkey;
    try {
      passkey = await verifyRegistration(registrationResponse(body), ceremony);
    } catch {
      throw new AuthenticationFlowError();
    }
    if (state.passkeys.some((candidate) => candidate.id === passkey.id)) {
      throw new AuthenticationFlowError();
    }
    if (!(await consumeFreshStepUp(request, claims))) throw new AuthenticationFlowError();

    const nextState = await mutateAuthState(
      (current) => {
        if (current.passkeys.some((candidate) => candidate.id === passkey.id)) {
          throw new AuthenticationFlowError();
        }
        return { ...current, passkeys: [...current.passkeys, passkey] };
      },
      state.revision,
    );

    const response = noStoreJson({
      ok: true,
      passkey: {
        id: passkey.id,
        label: passkey.label,
        createdAt: passkey.createdAt,
        transports: passkey.transports ?? [],
      },
      needsBackupPasskey: nextState.passkeys.length < 2,
    });
    clearCeremony(response);
    clearHostCookie(response, cookieNames.stepUp);
    refreshSession(response, claims);
    logManagementSuccess(request, "passkey.added", passkey.id);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.passkey");
    }
    return routeError(error);
  }
}
