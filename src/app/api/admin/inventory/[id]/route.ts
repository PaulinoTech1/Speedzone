import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { z } from "zod";

import { vehicleInputSchema, type VehicleRecord } from "@/lib/domain/vehicle";
import {
  InventoryValidationError,
  listAllVehicles,
  updateVehicle,
} from "@/lib/server/inventory";
import { noStoreJson, parseJsonBody, RequestValidationError } from "@/lib/server/request";
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
const vehicleIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function vehicleIdFrom(context: RouteContext): Promise<string> {
  const result = vehicleIdSchema.safeParse((await context.params).id);
  if (!result.success) {
    throw new RequestValidationError("Vehicle identifier is invalid", 400, "INVALID_VEHICLE_ID");
  }
  return result.data;
}

function revalidatePublishedChanges(before: VehicleRecord, after: VehicleRecord): void {
  if (before.status !== "published" && after.status !== "published") return;
  revalidateTag("inventory", "max");
  revalidatePath("/", "page");
  revalidatePath("/inventory", "page");

  if (before.status === "published") {
    revalidateTag(`vehicle:${before.slug}`, "max");
    revalidatePath(`/inventory/${before.slug}`, "page");
  }
  if (after.status === "published") {
    revalidateTag(`vehicle:${after.slug}`, "max");
    revalidatePath(`/inventory/${after.slug}`, "page");
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authorized = await requireAdmin(request);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const id = await vehicleIdFrom(context);
    const state = await listAllVehicles();
    const vehicle = state.vehicles.find((candidate) => candidate.id === id);
    if (!vehicle) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
    const response = noStoreJson({ ok: true, vehicle });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const id = await vehicleIdFrom(context);
    const input = await parseJsonBody(request, vehicleInputSchema, maximumVehicleBodyBytes);
    const current = await listAllVehicles();
    const before = current.vehicles.find((candidate) => candidate.id === id);
    if (!before) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
    const vehicle = await updateVehicle(id, input);
    revalidatePublishedChanges(before, vehicle);
    logSecurityEvent({
      event: before.status === vehicle.status ? "inventory.updated" : "inventory.status",
      outcome: "success",
      actorHash: actorSecurityHash(authorized.claims.administrator),
      clientHash: clientSecurityHash(request),
      recordId: vehicle.id,
    });
    const response = noStoreJson({ ok: true, vehicle });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
