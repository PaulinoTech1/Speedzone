import { NextRequest } from "next/server";

import {
  logManagementSuccess,
  requireEnabledAdministrator,
  requireFreshStepUp,
  successfulSessionResponse,
} from "@/app/api/admin/auth/_shared";
import { consumeFreshStepUp, sessionDigest } from "@/lib/server/auth/session";
import { RequestValidationError } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";
import { mutateAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ credentialId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    requireFreshStepUp(request, claims);
    await enforceRateLimit(request, "passkeyManagement", `delete:${sessionDigest(claims.sid)}`);
    const { credentialId } = await context.params;
    if (!credentialId || credentialId.length > 4096) {
      throw new RequestValidationError("Passkey not found", 404, "NOT_FOUND");
    }
    if (!state.passkeys.some((passkey) => passkey.id === credentialId)) {
      throw new RequestValidationError("Passkey not found", 404, "NOT_FOUND");
    }
    if (state.passkeys.length <= 1) {
      throw new RequestValidationError("The final passkey cannot be deleted", 409, "FINAL_PASSKEY");
    }
    if (!(await consumeFreshStepUp(request, claims))) {
      throw new RequestValidationError(
        "Fresh password and passkey verification required",
        403,
        "STEP_UP_REQUIRED",
      );
    }

    const nextState = await mutateAuthState(
      (current) => {
        if (!current.passkeys.some((passkey) => passkey.id === credentialId)) {
          throw new RequestValidationError("Passkey not found", 404, "NOT_FOUND");
        }
        if (current.passkeys.length <= 1) {
          throw new RequestValidationError("The final passkey cannot be deleted", 409, "FINAL_PASSKEY");
        }
        return {
          ...current,
          sessionEpoch: current.sessionEpoch + 1,
          passkeys: current.passkeys.filter((passkey) => passkey.id !== credentialId),
          revokedSessionHashes: [],
        };
      },
      state.revision,
    );

    logManagementSuccess(request, "passkey.deleted", credentialId);
    return successfulSessionResponse(nextState, {
      deleted: true,
      needsBackupPasskey: nextState.passkeys.length < 2,
    });
  } catch (error) {
    return routeError(error);
  }
}
