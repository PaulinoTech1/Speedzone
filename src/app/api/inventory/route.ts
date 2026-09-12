import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { appendVehiclePhotos, readInventory, sanitizeVehicleInput, writeInventory } from "@/lib/inventory";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isInventoryPhotoBlobOriginUrl, maxInventoryPhotoCount } from "@/lib/inventory-photos";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

export async function GET(request: Request) {
  try {
    const inventory = await readInventory();
    const adminRequest = await isAdminAuthenticated(request);
    return NextResponse.json(inventory, {
      headers: {
        "Cache-Control": adminRequest ? "private, no-store" : "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("[v0] inventory read failed", error);
    return NextResponse.json({ error: "Unable to load inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { vehicle?: unknown; photos?: unknown };
    const payload = body.vehicle && typeof body.vehicle === "object"
      ? body.vehicle as Record<string, unknown>
      : {};
    if (!Array.isArray(body.photos) || body.photos.length > maxInventoryPhotoCount || body.photos.some((photo) => typeof photo !== "string" || !isInventoryPhotoBlobOriginUrl(photo))) {
      return NextResponse.json({ error: "One or more photo uploads are invalid" }, { status: 400 });
    }
    const photos = body.photos as string[];
    const vehicle = sanitizeVehicleInput(payload, photos);
    const vehicles = await readInventory();
    await writeInventory([vehicle, ...vehicles]);
    await writeSecurityEvent({ ...securityRequestContext(request), event: "inventory.mutation", outcome: "allowed", actor: "admin", reason: "vehicle_created", metadata: { photo_count: photos.length } });
    return NextResponse.json(vehicle, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save vehicle" }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { id?: unknown; photos?: unknown } & Record<string, unknown>;
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const vehicles = await readInventory();
    if (body.photos === undefined) {
      const existing = vehicles.find((vehicle) => vehicle.id === body.id);
      if (!existing) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
      const updatedVehicle = sanitizeVehicleInput(body, existing.photos);
      await writeInventory(vehicles.map((item) => item.id === existing.id ? updatedVehicle : item));
      return NextResponse.json(updatedVehicle);
    }
    if (!Array.isArray(body.photos) || body.photos.length === 0 || body.photos.some((photo) => typeof photo !== "string" || !isInventoryPhotoBlobOriginUrl(photo))) {
      return NextResponse.json({ error: "One or more photo uploads are invalid" }, { status: 400 });
    }

    const updated = appendVehiclePhotos(vehicles, body.id, body.photos as string[]);
    await writeInventory(updated.inventory);
    return NextResponse.json(updated.vehicle);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update vehicle" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: unknown; photos?: unknown };
  const vehicles = await readInventory();
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
    await Promise.all(selectedPhotos.filter(isInventoryPhotoBlobOriginUrl).map((url) => del(url).catch(() => undefined)));
    await writeInventory(vehicles.map((item) => item.id === vehicle.id ? updatedVehicle : item));
    return NextResponse.json(updatedVehicle);
  }

  await Promise.all(vehicle.photos.filter(isInventoryPhotoBlobOriginUrl).map((url) => del(url).catch(() => undefined)));
  await writeInventory(vehicles.filter((item) => item.id !== body.id));
  return NextResponse.json({ ok: true });
}
