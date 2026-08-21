import "server-only";

import type { AuthLifecycleState } from "@/lib/domain/auth";
import { adminConfig, bootstrapEnrollmentRuntimePermitted } from "@/lib/server/env";
import { readAuthState } from "@/lib/server/storage/state";

export type ResolvedAdministratorAuthState = {
  state: AuthLifecycleState;
};

/**
 * Resolve setup availability without trusting browser state or request-host
 * headers. Storage failures deliberately propagate so callers fail closed.
 */
export async function resolveAdministratorAuthState(): Promise<ResolvedAdministratorAuthState> {
  if (!bootstrapEnrollmentRuntimePermitted()) return { state: "UNCONFIGURED" };

  const record = await readAuthState();
  if (record.state === "BOOTSTRAP_READY" && !adminConfig().bootstrapTokenHash) {
    return { state: "UNCONFIGURED" };
  }
  return { state: record.state };
}
