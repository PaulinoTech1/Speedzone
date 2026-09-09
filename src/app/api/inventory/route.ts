import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { appendVehiclePhotos, readInventory, sanitizeVehicleInput, writeInventory } from "@/lib/inventory";
import { isAdmin } from "@/lib/admin-auth";
import { isInventoryPhotoUrl, maxInventoryPhotoCount } from "@/lib/inventory-photos";

export async function GET() {
  try {
    const inventory = await readInventory();
    const adminRequest = await isAdmin();
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
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { vehicle?: unknown; photos?: unknown };
    const payload = body.vehicle && typeof body.vehicle === "object"
      ? body.vehicle as Record<string, unknown>
      : {};
    if (!Array.isArray(body.photos) || body.photos.length > maxInventoryPhotoCount || body.photos.some((photo) => typeof photo !== "string" || !isInventoryPhotoUrl(photo))) {
      return NextResponse.json({ error: "One or more photo uploads are invalid" }, { status: 400 });
    }
    const photos = body.photos as string[];
    const vehicle = sanitizeVehicleInput(payload, photos);
    const vehicles = await readInventory();
    await writeInventory([vehicle, ...vehicles]);
    return NextResponse.json(vehicle, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save vehicle" }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { id?: unknown; photos?: unknown };
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }
    if (!Array.isArray(body.photos) || body.photos.length === 0 || body.photos.some((photo) => typeof photo !== "string" || !isInventoryPhotoUrl(photo))) {
      return NextResponse.json({ error: "One or more photo uploads are invalid" }, { status: 400 });
    }

    const vehicles = await readInventory();
    const updated = appendVehiclePhotos(vehicles, body.id, body.photos as string[]);
    await writeInventory(updated.inventory);
    return NextResponse.json(updated.vehicle);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update vehicle" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  const vehicles = await readInventory();
  const vehicle = vehicles.find((item) => item.id === id);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  await Promise.all(vehicle.photos.map((url) => del(url).catch(() => undefined)));
  await writeInventory(vehicles.filter((item) => item.id !== id));
  return NextResponse.json({ ok: true });
}
