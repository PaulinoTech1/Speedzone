import { NextRequest } from "next/server";

import {
  logManagementSuccess,
  requireEnabledAdministrator,
} from "@/app/api/admin/auth/_shared";
import { sessionDigest } from "@/lib/server/auth/session";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { noStoreJson } from "@/lib/server/request";
import { assertAdminMutation, routeError } from "@/lib/server/route-utils";
import { mutateAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    const digest = sessionDigest(claims.sid);
    await mutateAuthState(
      (current) => {
        const alreadyRevoked = current.revokedSessionHashes.includes(digest);
        if (!alreadyRevoked && current.revokedSessionHashes.length >= 250) {
          return {
            ...current,
            sessionEpoch: current.sessionEpoch + 1,
            revokedSessionHashes: [],
          };
        }
        return {
          ...current,
          revokedSessionHashes: alreadyRevoked
            ? current.revokedSessionHashes
            : [...current.revokedSessionHashes, digest],
        };
      },
      state.revision,
    );
    const response = noStoreJson({ ok: true, authenticated: false });
    clearAuthenticationCookies(response);
    logManagementSuccess(request, "auth.logout");
    return response;
  } catch (error) {
    return routeError(error);
  }
}
