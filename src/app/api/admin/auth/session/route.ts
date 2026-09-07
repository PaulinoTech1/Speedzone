import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminConfig } from "@/lib/server/env";
import { noStoreJson } from "@/lib/server/request";
import { routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The administrator's passkeys live in the shared authentication record, not in
 * the Better Auth session. Report the real count so the portal's backup-passkey
 * nudge is accurate; a record that cannot be read yet is treated as "no verified
 * passkeys" (needs a backup) rather than silently claiming zero risk. Step-up is
 * bound to a custom session id that a Better Auth login never holds, so it is
 * genuinely not satisfied on this path.
 */
async function passkeyPosture(): Promise<{ passkeyCount: number; needsBackupPasskey: boolean }> {
  try {
    const state = await readAuthState();
    const passkeyCount = state.passkeys.length;
    return { passkeyCount, needsBackupPasskey: passkeyCount < 2 };
  } catch {
    return { passkeyCount: 0, needsBackupPasskey: true };
  }
}

export async function GET(_request: NextRequest) {
  try {
    const current = await getAuthSession();
    if (!current?.user || current.user.email.toLowerCase() !== adminConfig().identifier.toLowerCase()) {
      return noStoreJson({ ok: false, authenticated: false }, { status: 401 });
    }
    const { passkeyCount, needsBackupPasskey } = await passkeyPosture();
    return noStoreJson({
      ok: true,
      authenticated: true,
      administrator: current.user.email,
      absoluteExpiresAt: new Date(current.session.expiresAt).getTime(),
      passkeyCount,
      needsBackupPasskey,
      stepUpValid: false,
    });
  } catch (error) {
    return routeError(error);
  }
}
