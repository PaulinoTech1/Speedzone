import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";

import { vehicleInputSchema, type VehicleRecord } from "@/lib/domain/vehicle";
import { createVehicle, listAllVehicles } from "@/lib/server/inventory";
import { noStoreJson, parseJsonBody } from "@/lib/server/request";
import {
  assertAdminMutation,
  enforceRateLimit,
  requireAdmin,
  routeError,
} from "@/lib/server/route-utils";
import {
  actorSecurityHash,
  clientSecurityHash,
  logSecurityEvent,
} from "@/lib/server/security-log";
import { refreshSession } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumVehicleBodyBytes = 64 * 1024;

function revalidatePublishedVehicle(vehicle: VehicleRecord): void {
  if (vehicle.status !== "published") return;
  revalidateTag("inventory", "max");
  revalidateTag(`vehicle:${vehicle.slug}`, "max");
  revalidatePath("/", "page");
  revalidatePath("/inventory", "page");
  revalidatePath(`/inventory/${vehicle.slug}`, "page");
}

export async function GET(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    await enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const state = await listAllVehicles();
    const response = noStoreJson({
      ok: true,
      revision: state.revision,
      vehicles: state.vehicles,
    });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    await enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const input = await parseJsonBody(request, vehicleInputSchema, maximumVehicleBodyBytes);
    const vehicle = await createVehicle(input);
    revalidatePublishedVehicle(vehicle);
    logSecurityEvent({
      event: "inventory.created",
      outcome: "success",
      actorHash: actorSecurityHash(authorized.claims.administrator),
      clientHash: clientSecurityHash(request),
      recordId: vehicle.id,
    });
    const response = noStoreJson({ ok: true, vehicle }, { status: 201 });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
