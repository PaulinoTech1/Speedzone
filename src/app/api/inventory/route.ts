import { withDiagnostics } from "@/lib/diagnostics";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { NextResponse } from "next/server";
import { appendVehiclePhotos, normalizeEtag, readInventorySnapshot, sanitizeVehicleInput, writeInventory } from "@/lib/inventory";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { diagnoseInventoryPhotoUrl, isInventoryPhotoBlobOriginUrl, maxInventoryPhotoCount } from "@/lib/inventory-photos";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

async function diagnosedGET(request: Request) {
  try {
    const { vehicles: inventory, revision } = await readInventorySnapshot();
    const adminRequest = await isAdminAuthenticated(request);
    return NextResponse.json(inventory, {
      headers: {
        "ETag": revision,
        "Cache-Control": adminRequest ? "private, no-store" : "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("[v0] inventory read failed", error);
    return NextResponse.json({ error: "Unable to load inventory" }, { status: 500 });
  }
}

async function diagnosedPOST(request: Request) {
  const context=securityRequestContext(request,true);
  if (!(await isAdminAuthenticated(request))) {await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"denied",actor:"anonymous",reason:"authentication_required",metadata:{operation:"create"}});return NextResponse.json({ error: "Unauthorized" }, { status: 401 });}
  try {
    const body = (await request.json()) as { vehicle?: unknown; photos?: unknown };
    const payload = body.vehicle && typeof body.vehicle === "object"
      ? body.vehicle as Record<string, unknown>
      : {};
    if (!Array.isArray(body.photos) || body.photos.length > maxInventoryPhotoCount) {
      return NextResponse.json({ error: `Photo upload list is invalid: provide between 0 and ${maxInventoryPhotoCount} photo URLs.` }, { status: 400 });
    }
    const invalidPhoto = body.photos.map((photo, index) => ({ index, reason: diagnoseInventoryPhotoUrl(photo) })).find((photo) => photo.reason);
    if (invalidPhoto?.reason) {
      return NextResponse.json({ error: `Photo ${invalidPhoto.index + 1} is invalid: ${invalidPhoto.reason}` }, { status: 400 });
    }
    const photos = body.photos as string[];
    const vehicle = sanitizeVehicleInput({ ...payload, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, photos);
    const { vehicles, revision } = await readInventorySnapshot();
    if (normalizeEtag(request.headers.get("if-match")) !== revision) { await writeSecurityEvent({ ...context, event:"inventory.mutation",outcome:"denied",actor:"admin",reason:"revision_conflict",metadata:{operation:"create",catalog_revision:revision} }); return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 }); }
    const saved = await writeInventory([vehicle, ...vehicles], revision);
    await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "allowed", actor: "admin", reason: "vehicle_created", metadata: { photo_count: photos.length, catalog_revision_before:revision,catalog_revision_after:saved.etag } });
    return NextResponse.json(vehicle, { status: 201, headers: { ETag: saved.etag } });
  } catch (error) { await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"failed",actor:"admin",reason:"create_failed",metadata:{failure_class:error instanceof Error?(error.constructor?.name||error.name):"UnknownError"}});return mutationError(error); }
}

async function handlePATCH(request: Request) {
  const context=securityRequestContext(request,true);
  if (!(await isAdminAuthenticated(request))) {await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"denied",actor:"anonymous",reason:"authentication_required",metadata:{operation:"update"}});return NextResponse.json({ error: "Unauthorized" }, { status: 401 });}
  try {
    const body = (await request.json()) as { id?: unknown; photos?: unknown } & Record<string, unknown>;
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const { vehicles, revision } = await readInventorySnapshot();
    if (normalizeEtag(request.headers.get("if-match")) !== revision) { await writeSecurityEvent({ ...context, event:"inventory.mutation",outcome:"denied",actor:"admin",reason:"revision_conflict",metadata:{operation:"update",catalog_revision:revision} }); return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 }); }
    if (body.photos === undefined) {
      const existing = vehicles.find((vehicle) => vehicle.id === body.id);
      if (!existing) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
      const updatedVehicle = sanitizeVehicleInput({ ...body, vin: body.vin === undefined ? existing.vin : body.vin, id: existing.id, createdAt: existing.createdAt }, existing.photos);
      const saved = await writeInventory(vehicles.map((item) => item.id === existing.id ? updatedVehicle : item), revision);
      await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"allowed",actor:"admin",reason:"vehicle_updated",metadata:{catalog_revision_before:revision,catalog_revision_after:saved.etag}});
      return NextResponse.json(updatedVehicle, { headers: { ETag: saved.etag } });
    }
    if (!Array.isArray(body.photos) || body.photos.length === 0) {
      return NextResponse.json({ error: "Photo upload list is invalid: provide at least one photo URL." }, { status: 400 });
    }
    const invalidPhoto = body.photos.map((photo, index) => ({ index, reason: diagnoseInventoryPhotoUrl(photo) })).find((photo) => photo.reason);
    if (invalidPhoto?.reason) {
      return NextResponse.json({ error: `Photo ${invalidPhoto.index + 1} is invalid: ${invalidPhoto.reason}` }, { status: 400 });
    }

    const updated = appendVehiclePhotos(vehicles, body.id, body.photos as string[]);
    const saved = await writeInventory(updated.inventory, revision);
    await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"allowed",actor:"admin",reason:"photos_attached",metadata:{photo_count:(body.photos as string[]).length,catalog_revision_before:revision,catalog_revision_after:saved.etag}});
    return NextResponse.json(updated.vehicle, { headers: { ETag: saved.etag } });
  } catch (error) {
    await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"failed",actor:"admin",reason:"update_failed",metadata:{failure_class:error instanceof Error?(error.constructor?.name||error.name):"UnknownError"}});
    return mutationError(error);
  }
}

async function handleDELETE(request: Request) {
  const context=securityRequestContext(request,true);
  if (!(await isAdminAuthenticated(request))) {await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"denied",actor:"anonymous",reason:"authentication_required",metadata:{operation:"delete"}});return NextResponse.json({ error: "Unauthorized" }, { status: 401 });}
  try {
  const body = await request.json().catch(() => ({})) as { id?: unknown; photos?: unknown };
  const { vehicles, revision } = await readInventorySnapshot();
    if (normalizeEtag(request.headers.get("if-match")) !== revision) { await writeSecurityEvent({ ...context, event:"inventory.mutation",outcome:"denied",actor:"admin",reason:"revision_conflict",metadata:{operation:"delete",catalog_revision:revision} }); return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 }); }
  const vehicle = vehicles.find((item) => item.id === body.id);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length === 0 || body.photos.some((photo) => typeof photo !== "string" || !isInventoryPhotoBlobOriginUrl(photo))) {
      return NextResponse.json({ error: "Selected photos are invalid" }, { status: 400 });
    }
    const selectedPhotos = [...new Set(body.photos as string[])];
    if (selectedPhotos.some((photo) => !vehicle.photos.includes(photo))) {
      return NextResponse.json({ error: "Selected photo does not belong to this listing" }, { status: 400 });
    }
    const updatedVehicle = { ...vehicle, photos: vehicle.photos.filter((photo) => !selectedPhotos.includes(photo)) };
    const saved = await writeInventory(vehicles.map((item) => item.id === vehicle.id ? updatedVehicle : item), revision);
    await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"allowed",actor:"admin",reason:"photos_removed_from_listing",metadata:{photo_count:selectedPhotos.length,catalog_revision_before:revision,catalog_revision_after:saved.etag}});
    return NextResponse.json(updatedVehicle, { headers: { ETag: saved.etag } });
  }

  const saved = await writeInventory(vehicles.filter((item) => item.id !== body.id), revision);
  await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"allowed",actor:"admin",reason:"vehicle_deleted",metadata:{photo_count:vehicle.photos.length,catalog_revision_before:revision,catalog_revision_after:saved.etag}});
  return NextResponse.json({ ok: true }, { headers: { ETag: saved.etag } });
  } catch (error) { await writeSecurityEvent({...context,event:"inventory.mutation",outcome:"failed",actor:"admin",reason:"delete_failed",metadata:{failure_class:error instanceof Error?(error.constructor?.name||error.name):"UnknownError"}});return mutationError(error); }
}

function mutationError(error: unknown) {
  if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 });
  return NextResponse.json({ error: "Unable to save inventory. Check your input and reload before retrying." }, { status: 400 });
}

async function diagnosedPATCH(request: Request) { return handlePATCH(request); }

async function diagnosedDELETE(request: Request) { return handleDELETE(request); }

export async function GET(request: Request) { return withDiagnostics("INVENTORY_CATALOG_READ", () => diagnosedGET(request)); }

export async function POST(request: Request) { return withDiagnostics("INVENTORY_LISTING_CREATE", () => diagnosedPOST(request)); }

export async function PATCH(request: Request) { return withDiagnostics("INVENTORY_LISTING_UPDATE", () => diagnosedPATCH(request)); }

export async function DELETE(request: Request) { return withDiagnostics("INVENTORY_LISTING_REMOVE", () => diagnosedDELETE(request)); }
