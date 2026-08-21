import { NextRequest } from "next/server";

import {
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import { refreshSession } from "@/lib/server/auth/session";
import { noStoreJson } from "@/lib/server/request";
import { routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    requireFreshStepUp(request, claims);
    const response = noStoreJson({
      ok: true,
      passkeys: state.passkeys.map(({ id, label, createdAt, transports }) => ({
        id,
        label,
        createdAt,
        transports: transports ?? [],
      })),
      needsBackupPasskey: state.passkeys.length < 2,
    });
    refreshSession(response, claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
