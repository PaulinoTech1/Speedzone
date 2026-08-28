import { NextRequest } from "next/server";
import { z } from "zod";

import { refreshSession } from "@/lib/server/auth/session";
import {
  deleteOrphanedPhoto,
  PhotoLibraryDeletionError,
  readPhotoLibrary,
} from "@/lib/server/photo-library";
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

const deleteBodySchema = z
  .object({
    // Only used to look the object up in the recomputed library; it is never
    // passed to the storage client as a deletion target on its own.
    pathname: z.string().trim().min(1).max(512),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const library = await readPhotoLibrary();
    const response = noStoreJson({ ok: true, ...library });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authorized = await requireAdmin(request);
    assertAdminMutation(request, authorized.claims);
    enforceRateLimit(request, "inventory", authorized.claims.administrator);
    const body = await parseJsonBody(request, deleteBodySchema, 2 * 1024);

    let removed;
    try {
      removed = await deleteOrphanedPhoto(body.pathname);
    } catch (error) {
      if (error instanceof PhotoLibraryDeletionError) {
        throw new RequestValidationError(error.message, 409, "PHOTO_NOT_DELETABLE");
      }
      throw error;
    }

    logSecurityEvent({
      event: "photo.deleted",
      outcome: "success",
      actorHash: actorSecurityHash(authorized.claims.administrator),
      clientHash: clientSecurityHash(request),
      recordId: removed.vehicleId ?? undefined,
      reason: removed.state,
    });

    const library = await readPhotoLibrary();
    const response = noStoreJson({ ok: true, removed: removed.pathname, ...library });
    refreshSession(response, authorized.claims);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
