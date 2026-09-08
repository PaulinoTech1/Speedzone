import { del, put } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readInventory, sanitizeVehicleInput, writeInventory } from "@/lib/inventory";

async function isAdmin() { return (await cookies()).get("speedzone_admin")?.value === "authenticated"; }

export async function GET() {
  try { return NextResponse.json(await readInventory()); }
  catch (error) { console.error("[v0] inventory read failed", error); return NextResponse.json({ error: "Unable to load inventory" }, { status: 500 }); }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await request.formData();
    const payload = JSON.parse(String(form.get("vehicle") || "{}")) as Record<string, unknown>;
    const photos: string[] = [];
    for (const entry of form.getAll("photos")) {
      if (!(entry instanceof File) || entry.size === 0) continue;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(entry.type) || entry.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Photos must be JPG, PNG, or WebP images under 8MB" }, { status: 400 });
      const blob = await put(`inventory/${crypto.randomUUID()}-${entry.name.replace(/[^a-zA-Z0-9._-]/g, "")}`, entry, { access: "public", contentType: entry.type });
      photos.push(blob.url);
    }
    const vehicle = sanitizeVehicleInput(payload, photos);
    const vehicles = await readInventory();
    await writeInventory([vehicle, ...vehicles]);
    return NextResponse.json(vehicle, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save vehicle" }, { status: 400 }); }
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
