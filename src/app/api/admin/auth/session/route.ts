import { NextRequest } from "next/server";

import { requireEnabledAdministrator } from "@/app/api/admin/auth/_shared";
import { hasValidStepUp, refreshSession } from "@/lib/server/auth/session";
import { noStoreJson } from "@/lib/server/request";
import { routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    const response = noStoreJson({
      ok: true,
      authenticated: true,
      administrator: claims.administrator,
      absoluteExpiresAt: claims.absoluteExpiresAt,
      passkeyCount: state.passkeys.length,
      needsBackupPasskey: state.passkeys.length < 2,
      stepUpValid: hasValidStepUp(request, claims),
    });
    refreshSession(response, claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
