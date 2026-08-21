import { NextRequest } from "next/server";

import {
  logManagementSuccess,
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { consumeFreshStepUp } from "@/lib/server/auth/session";
import { noStoreJson, RequestValidationError } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";
import { mutateAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    requireFreshStepUp(request, claims);
    enforceRateLimit(request, "passkeyManagement", "revoke-all-sessions");
    if (!(await consumeFreshStepUp(request, claims))) {
      throw new RequestValidationError(
        "Fresh password and passkey verification required",
        403,
        "STEP_UP_REQUIRED",
      );
    }
    await mutateAuthState(
      (current) => ({
        ...current,
        sessionEpoch: current.sessionEpoch + 1,
        revokedSessionHashes: [],
      }),
      state.revision,
    );
    const response = noStoreJson({ ok: true, authenticated: false });
    clearAuthenticationCookies(response);
    logManagementSuccess(request, "auth.session_revoked");
    return response;
  } catch (error) {
    return routeError(error);
  }
}
