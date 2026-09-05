import { NextRequest } from "next/server";

import {
  logAuthenticationSuccess,
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import { generateRecoveryCodes } from "@/lib/server/auth/recovery";
import {
  consumeFreshStepUp,
  refreshSession,
  sessionDigest,
} from "@/lib/server/auth/session";
import { clearHostCookie, cookieNames } from "@/lib/server/cookies";
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
    await enforceRateLimit(request, "recovery", `rotate:${sessionDigest(claims.sid)}`);
    if (!(await consumeFreshStepUp(request, claims))) {
      throw new RequestValidationError(
        "Fresh password and passkey verification required",
        403,
        "STEP_UP_REQUIRED",
      );
    }
    const recovery = generateRecoveryCodes();
    await mutateAuthState(
      (current) => ({ ...current, recoveryCodeHashes: recovery.hashes }),
      state.revision,
    );
    const response = noStoreJson({ ok: true, recoveryCodes: recovery.codes });
    clearHostCookie(response, cookieNames.stepUp);
    refreshSession(response, claims);
    logAuthenticationSuccess(request, "auth.recovery");
    return response;
  } catch (error) {
    return routeError(error);
  }
}
