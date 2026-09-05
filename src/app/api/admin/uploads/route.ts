import { NextRequest } from "next/server";
import { z } from "zod";

import { refreshSession } from "@/lib/server/auth/session";
import { imageLimits } from "@/lib/server/env";
import { uploadVehiclePhoto, verifyAndNormalizeWebP } from "@/lib/server/photos";
import { noStoreJson, readBoundedBinaryBody, RequestValidationError } from "@/lib/server/request";
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
import { sanity, translateSanityError } from "@/lib/server/storage/sanity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  vehicleId: z.uuid(),
  alt: z.string().trim().max(180),
});

type VehicleExistenceCheck = { _type?: unknown; photographs?: unknown };

/**
 * A targeted single-document read, replacing the previous full-inventory
 * fetch-then-`.find()` this route used to do against Blob.
 */
async function assertVehicleAcceptsAnotherPhoto(vehicleId: string): Promise<void> {
  let doc: VehicleExistenceCheck | undefined;
  try {
    doc = await sanity().getDocument<VehicleExistenceCheck>(vehicleId);
  } catch (error) {
    throw translateSanityError(error);
  }
  if (!doc || doc._type !== "vehicle") {
    throw new RequestValidationError("Vehicle was not found", 404, "NOT_FOUND");
  }
  const photographCount = Array.isArray(doc.photographs) ? doc.photographs.length : 0;
  if (photographCount >= 12) {
    throw new RequestValidationError("Photograph limit reached", 422, "PHOTO_LIMIT_REACHED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    await enforceRateLimit(request, "inventory", authorized.claims.administrator);

    const query = querySchema.safeParse({
      vehicleId: request.nextUrl.searchParams.get("vehicleId"),
      alt: request.nextUrl.searchParams.get("alt") ?? "",
    });
    if (!query.success) {
      throw new RequestValidationError("Upload context is invalid", 422, "INVALID_UPLOAD_CONTEXT");
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "image/webp") {
      throw new RequestValidationError("Photograph must be WebP", 422, "INVALID_UPLOAD");
    }

    // Confirm the vehicle can accept another photo before spending any time on
    // the body: a bad vehicleId fails fast without decoding anything.
    await assertVehicleAcceptsAnotherPhoto(query.data.vehicleId);

    const { maximumBytes, maximumDimension } = imageLimits();
    const raw = await readBoundedBinaryBody(request, maximumBytes);
    let verified;
    try {
      verified = await verifyAndNormalizeWebP(raw, maximumDimension, maximumBytes);
    } catch {
      throw new RequestValidationError("Photograph is not a valid WebP image", 422, "INVALID_UPLOAD");
    }

    const photograph = await uploadVehiclePhoto({
      buffer: verified.buffer,
      width: verified.width,
      height: verified.height,
      alt: query.data.alt,
    });

    logSecurityEvent({
      event: "upload.authorized",
      outcome: "success",
      actorHash: actorSecurityHash(authorized.claims.administrator),
      clientHash: clientSecurityHash(request),
      recordId: query.data.vehicleId,
    });
    const response = noStoreJson({ ok: true, photograph }, { status: 201 });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    logSecurityEvent({
      event: "upload.rejected",
      outcome: "blocked",
      clientHash: clientSecurityHash(request),
      reason: error instanceof RequestValidationError ? error.code : "UPLOAD_REJECTED",
    });
    return routeError(error);
  }
}
