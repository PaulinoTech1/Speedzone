import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest } from "next/server";
import { z } from "zod";

import { refreshSession } from "@/lib/server/auth/session";
import { imageLimits, privateBlobToken } from "@/lib/server/env";
import { InventoryValidationError, listAllVehicles } from "@/lib/server/inventory";
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

const uploadRequestSchema = z
  .object({
    type: z.literal("blob.generate-client-token"),
    payload: z
      .object({
        pathname: z.string().min(1).max(256),
        multipart: z.boolean(),
        clientPayload: z.string().max(1024).nullable(),
      })
      .strict(),
  })
  .strict();

const uploadClientPayloadSchema = z
  .object({
    vehicleId: z.uuid(),
  })
  .strict();

function parseClientPayload(clientPayload: string | null): { vehicleId: string } {
  if (!clientPayload) {
    throw new RequestValidationError("Upload context is invalid", 422, "INVALID_UPLOAD_CONTEXT");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(clientPayload);
  } catch {
    throw new RequestValidationError("Upload context is invalid", 422, "INVALID_UPLOAD_CONTEXT");
  }
  const result = uploadClientPayloadSchema.safeParse(candidate);
  if (!result.success) {
    throw new RequestValidationError("Upload context is invalid", 422, "INVALID_UPLOAD_CONTEXT");
  }
  return result.data;
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const body = await parseJsonBody(request, uploadRequestSchema, 8 * 1024);
    const token = privateBlobToken();
    if (!token) {
      throw new RequestValidationError(
        "Photo upload storage is unavailable",
        503,
        "SERVICE_NOT_CONFIGURED",
      );
    }

    const result = await handleUpload({
      request,
      body: body as HandleUploadBody,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const callbackAuthorization = await requireAdmin(request);
        assertAdminMutation(request, callbackAuthorization.claims);

        if (multipart) {
          throw new RequestValidationError("Multipart uploads are not permitted", 422, "INVALID_UPLOAD");
        }
        const { vehicleId } = parseClientPayload(clientPayload);
        const expectedPathname = `staging/vehicles/${vehicleId}/photo.webp`;
        if (pathname !== expectedPathname) {
          throw new RequestValidationError("Upload path is invalid", 422, "INVALID_UPLOAD_PATH");
        }
        const inventory = await listAllVehicles();
        const vehicle = inventory.vehicles.find((candidate) => candidate.id === vehicleId);
        if (!vehicle) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
        if (vehicle.photographs.length >= 12) {
          throw new RequestValidationError("Photograph limit reached", 422, "PHOTO_LIMIT_REACHED");
        }

        logSecurityEvent({
          event: "upload.authorized",
          outcome: "success",
          actorHash: actorSecurityHash(authorized.claims.administrator),
          clientHash: clientSecurityHash(request),
          recordId: vehicleId,
        });
        return {
          allowedContentTypes: ["image/webp"],
          maximumSizeInBytes: imageLimits().maximumBytes,
          validUntil: Date.now() + 2 * 60_000,
          addRandomSuffix: true,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ vehicleId }),
        };
      },
    });
    const response = noStoreJson(result);
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
