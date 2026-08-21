import { NextRequest } from "next/server";
import { z } from "zod";

import { refreshSession } from "@/lib/server/auth/session";
import { photoBlobToken, privateBlobToken } from "@/lib/server/env";
import { InventoryValidationError, listAllVehicles } from "@/lib/server/inventory";
import { finalizeVehiclePhoto } from "@/lib/server/photos";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const finalizePhotoSchema = z
  .object({
    stagingUrl: z.url().max(2048),
    vehicleId: z.uuid(),
    alt: z.string().trim().max(180),
  })
  .strict();

function ownedStagingPath(stagingUrl: string, vehicleId: string): string {
  const parsed = new URL(stagingUrl);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".private.blob.vercel-storage.com") ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RequestValidationError("Staged photograph is invalid", 422, "INVALID_STAGED_PHOTO");
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    throw new RequestValidationError("Staged photograph is invalid", 422, "INVALID_STAGED_PHOTO");
  }
  const expectedPrefix = `staging/vehicles/${vehicleId}/`;
  const filename = pathname.slice(expectedPrefix.length);
  if (
    !pathname.startsWith(expectedPrefix) ||
    !/^photo-[A-Za-z0-9]+\.webp$/.test(filename)
  ) {
    throw new RequestValidationError("Staged photograph is invalid", 422, "INVALID_STAGED_PHOTO");
  }
  return pathname;
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const input = await parseJsonBody(request, finalizePhotoSchema, 8 * 1024);
    if (!privateBlobToken() || !photoBlobToken()) {
      throw new RequestValidationError(
        "Photo storage is unavailable",
        503,
        "SERVICE_NOT_CONFIGURED",
      );
    }
    const stagingPath = ownedStagingPath(input.stagingUrl, input.vehicleId);
    const inventory = await listAllVehicles();
    const vehicle = inventory.vehicles.find((candidate) => candidate.id === input.vehicleId);
    if (!vehicle) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
    if (vehicle.photographs.length >= 12) {
      throw new RequestValidationError("Photograph limit reached", 422, "PHOTO_LIMIT_REACHED");
    }

    // Pass the verified pathname, not the caller-controlled host, so the Blob SDK
    // always reads from the store encoded by the server-only private token.
    const photograph = await finalizeVehiclePhoto({ ...input, stagingUrl: stagingPath });
    logSecurityEvent({
      event: "upload.authorized",
      outcome: "success",
      actorHash: actorSecurityHash(authorized.claims.administrator),
      clientHash: clientSecurityHash(request),
      recordId: input.vehicleId,
      reason: "finalized",
    });
    const response = noStoreJson({ ok: true, photograph }, { status: 201 });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    logSecurityEvent({
      event: "upload.rejected",
      outcome: "blocked",
      clientHash: clientSecurityHash(request),
      reason: error instanceof RequestValidationError ? error.code : "FINALIZE_REJECTED",
    });
    return routeError(error);
  }
}
