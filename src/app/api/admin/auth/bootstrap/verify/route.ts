import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
  logManagementSuccess,
  registrationBodySchema,
  registrationResponse,
  requireBootstrapPreAuthentication,
  stableAdministratorUserId,
} from "@/app/api/admin/auth/_shared";
import { generateRecoveryCodes } from "@/lib/server/auth/recovery";
import { burnCeremony, readCeremony, verifyRegistration } from "@/lib/server/auth/webauthn";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { nextSessionEpoch } from "@/lib/server/crypto";
import { assertCsrf } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import {
  assertBootstrapEnrollmentRequest,
  noStoreJson,
  parseStrictJsonBody,
} from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import {
  StateConflictError,
  StateConfigurationError,
  mutateAuthState,
  readAuthState,
} from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertBootstrapEnrollmentRequest(request);
    await enforceClientRateLimit(request, "passkeyManagement");
    const state = await readAuthState();
    if (state.state !== "BOOTSTRAP_READY") throw new AuthenticationFlowError();
    if (!adminConfig().bootstrapTokenHash) {
      throw new StateConfigurationError("Bootstrap credential is not configured");
    }
    const preAuthentication = requireBootstrapPreAuthentication(request, state);
    assertCsrf(request, preAuthentication.sid);

    const body = await parseStrictJsonBody(request, registrationBodySchema, 128 * 1024);
    const ceremony = readCeremony(request, "bootstrap", preAuthentication.sid, state);
    if (!ceremony || !(await burnCeremony(ceremony))) throw new AuthenticationFlowError();

    let passkey;
    try {
      passkey = await verifyRegistration(registrationResponse(body), ceremony);
    } catch {
      throw new AuthenticationFlowError();
    }

    const recovery = generateRecoveryCodes();
    await mutateAuthState(
      (current) => {
        if (current.state !== "BOOTSTRAP_READY" || current.passkeys.length !== 0) {
          throw new AuthenticationFlowError();
        }
        return {
          ...current,
          state: "ACTIVE",
          administratorUserId: stableAdministratorUserId(),
          sessionEpoch: nextSessionEpoch(current.sessionEpoch),
          passkeys: [passkey],
          recoveryCodeHashes: recovery.hashes,
          revokedSessionHashes: [],
        };
      },
      state.revision,
    );

    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.bootstrap");
    logManagementSuccess(request, "passkey.added", passkey.id);
    const response = noStoreJson({
      ok: true,
      authenticated: false,
      setupComplete: true,
      next: "login",
      recoveryCodes: recovery.codes,
    });
    clearAuthenticationCookies(response);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError || error instanceof StateConflictError) {
      return authenticationFailureResponse(request, "auth.bootstrap");
    }
    return routeError(error);
  }
}
