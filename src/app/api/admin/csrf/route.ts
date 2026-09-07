import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import {
  authorizeSession,
  readBootstrapPreAuthentication,
  readPreAuthentication,
} from "@/lib/server/auth/session";
import { csrfResponse } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import { routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // The primary login path authenticates through Better Auth, which sets only
    // the Better Auth session cookie. requireAdmin binds mutations to that
    // session's id, so CSRF must be issued against the same id or every admin
    // write is rejected. This mirrors requireAdmin's Better Auth branch exactly.
    const neonSession = await getAuthSession();
    const allowlistedEmail = adminConfig().identifier.toLowerCase();
    if (neonSession?.user?.email?.toLowerCase() === allowlistedEmail) {
      return csrfResponse(neonSession.session.id);
    }

    const session = await authorizeSession(request);
    if (session) return csrfResponse(session.claims.sid);
    const state = await readAuthState();
    const bootstrap = readBootstrapPreAuthentication(request, state);
    if (bootstrap) return csrfResponse(bootstrap.sid);
    const preAuth = readPreAuthentication(request, state);
    return csrfResponse(preAuth?.sid ?? "anonymous");
  } catch (error) {
    return routeError(error);
  }
}
