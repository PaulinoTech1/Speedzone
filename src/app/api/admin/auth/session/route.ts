import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminConfig } from "@/lib/server/env";
import { noStoreJson } from "@/lib/server/request";
import { routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const current = await getAuthSession();
    if (!current?.user || current.user.email.toLowerCase() !== adminConfig().identifier.toLowerCase()) {
      return noStoreJson({ ok: false, authenticated: false }, { status: 401 });
    }
    return noStoreJson({
      ok: true,
      authenticated: true,
      administrator: current.user.email,
      absoluteExpiresAt: new Date(current.session.expiresAt).getTime(),
      passkeyCount: 0,
      needsBackupPasskey: false,
      stepUpValid: false,
    });
  } catch (error) {
    return routeError(error);
  }
}
