import {
  resolveAdministratorAuthState,
} from "@/lib/server/auth/state-machine";
import { noStoreJson } from "@/lib/server/request";
import { routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const resolved = await resolveAdministratorAuthState();
    if (resolved.state === "UNCONFIGURED") {
      return noStoreJson(
        { ok: false, error: { code: "SERVICE_NOT_CONFIGURED", message: "Setup is unavailable" } },
        { status: 503 },
      );
    }
    if (resolved.state !== "BOOTSTRAP_READY") {
      return noStoreJson(
        { ok: false, error: { code: "NOT_FOUND", message: "Not found" } },
        { status: 404 },
      );
    }
    return noStoreJson({ ok: true, state: "BOOTSTRAP_READY" });
  } catch (error) {
    return routeError(error);
  }
}
