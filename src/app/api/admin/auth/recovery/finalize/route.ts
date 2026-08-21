import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearAuthenticationFailures,
  logAuthenticationSuccess,
  logManagementSuccess,
  readPendingRecovery,
  stableAdministratorUserId,
} from "@/app/api/admin/auth/_shared";
import { generateRecoveryCodes } from "@/lib/server/auth/recovery";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { nextSessionEpoch } from "@/lib/server/crypto";
import { assertCsrf } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import { assertAllowedOrigin, noStoreJson } from "@/lib/server/request";
import { enforceRateLimit, routeError } from "@/lib/server/route-utils";
import {
  StateConflictError,
  mutateAuthState,
  readAuthState,
} from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    enforceRateLimit(request, "recovery", "administrator-recovery");
    const state = await readAuthState();
    const pending = readPendingRecovery(request, state);
    if (!pending || adminConfig().disabled || state.state !== "RECOVERY") {
      throw new AuthenticationFlowError();
    }
    assertCsrf(request, pending.sid);

    const recovery = generateRecoveryCodes();
    await mutateAuthState(
      (current) => {
        if (current.state !== "RECOVERY") throw new AuthenticationFlowError();
        if (!current.recoveryCodeHashes.includes(pending.recoveryCodeHash)) {
          throw new AuthenticationFlowError();
        }
        if (current.passkeys.some((candidate) => candidate.id === pending.passkey.id)) {
          throw new AuthenticationFlowError();
        }
        return {
          ...current,
          state: "ACTIVE",
          administratorUserId: stableAdministratorUserId(),
          sessionEpoch: nextSessionEpoch(current.sessionEpoch),
          passkeys: [pending.passkey],
          recoveryCodeHashes: recovery.hashes,
          revokedSessionHashes: [],
        };
      },
      state.revision,
    );

    clearAuthenticationFailures(request);
    logAuthenticationSuccess(request, "auth.recovery");
    logManagementSuccess(request, "passkey.added", pending.passkey.id);
    const response = noStoreJson({
      ok: true,
      authenticated: false,
      recovered: true,
      next: "login",
      recoveryCodes: recovery.codes,
    });
    clearAuthenticationCookies(response);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError || error instanceof StateConflictError) {
      return authenticationFailureResponse(request, "auth.recovery");
    }
    return routeError(error);
  }
}
