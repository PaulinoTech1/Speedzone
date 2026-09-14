import { withDiagnostics } from "@/lib/diagnostics";
import { auditRoute } from "@/lib/security-events";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { NextResponse } from "next/server";
import { appendVehiclePhotos, readInventorySnapshot, sanitizeVehicleInput, writeInventory } from "@/lib/inventory";
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
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (request.headers.get("if-match") !== revision) return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 });
    const saved = await writeInventory([vehicle, ...vehicles], revision);
    await writeSecurityEvent({ ...securityRequestContext(request), event: "inventory.mutation", outcome: "allowed", actor: "admin", reason: "vehicle_created", metadata: { photo_count: photos.length } });
    return NextResponse.json(vehicle, { status: 201, headers: { ETag: saved.etag } });
  } catch (error) { return mutationError(error); }
}

async function handlePATCH(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { id?: unknown; photos?: unknown } & Record<string, unknown>;
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const { vehicles, revision } = await readInventorySnapshot();
    if (request.headers.get("if-match") !== revision) return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 });
    if (body.photos === undefined) {
      const existing = vehicles.find((vehicle) => vehicle.id === body.id);
      if (!existing) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
      const updatedVehicle = sanitizeVehicleInput({ ...body, id: existing.id, createdAt: existing.createdAt }, existing.photos);
      const saved = await writeInventory(vehicles.map((item) => item.id === existing.id ? updatedVehicle : item), revision);
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
    return NextResponse.json(updated.vehicle, { headers: { ETag: saved.etag } });
  } catch (error) {
    return mutationError(error);
  }
}

async function handleDELETE(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
  const body = await request.json().catch(() => ({})) as { id?: unknown; photos?: unknown };
  const { vehicles, revision } = await readInventorySnapshot();
    if (request.headers.get("if-match") !== revision) return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 });
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
    return NextResponse.json(updatedVehicle, { headers: { ETag: saved.etag } });
  }

  const saved = await writeInventory(vehicles.filter((item) => item.id !== body.id), revision);
  return NextResponse.json({ ok: true }, { headers: { ETag: saved.etag } });
  } catch (error) { return mutationError(error); }
}

function mutationError(error: unknown) {
  if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) return NextResponse.json({ error: "Inventory changed. Reload inventory and review your edit before retrying." }, { status: 409 });
  return NextResponse.json({ error: "Unable to save inventory. Check your input and reload before retrying." }, { status: 400 });
}

async function diagnosedPATCH(request: Request) { return auditRoute(request, "inventory.mutation", () => handlePATCH(request), "patch", "admin"); }

async function diagnosedDELETE(request: Request) { return auditRoute(request, "inventory.mutation", () => handleDELETE(request), "delete", "admin"); }

export async function GET(request: Request) { return withDiagnostics("INVENTORY_CATALOG_READ", () => diagnosedGET(request)); }

export async function POST(request: Request) { return withDiagnostics("INVENTORY_LISTING_CREATE", () => diagnosedPOST(request)); }

export async function PATCH(request: Request) { return withDiagnostics("INVENTORY_LISTING_UPDATE", () => diagnosedPATCH(request)); }

export async function DELETE(request: Request) { return withDiagnostics("INVENTORY_LISTING_REMOVE", () => diagnosedDELETE(request)); }
