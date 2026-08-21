import { NextRequest } from "next/server";

import {
  authorizeSession,
  readBootstrapPreAuthentication,
  readPreAuthentication,
} from "@/lib/server/auth/session";
import { csrfResponse } from "@/lib/server/csrf";
import { routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
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
