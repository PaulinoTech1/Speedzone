import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { maxInventoryPhotoCount } from "@/lib/inventory-photos";
import { sanitizeVehicleDetails, validDetail, vehicleDetailKeys, type VehicleDetails } from "@/lib/vehicle-details";
export * from "@/lib/vehicle-details";
import { getRedis } from "@/lib/redis";
import { invalidatePublicInventory } from "@/lib/public-cache-invalidation";
import { canonicalInventoryPhotoUrl, inventoryCommitScript, inventoryPhotoStateKey, inventoryStateKey } from "@/lib/inventory-state";

/**
 * Normalize an ETag for comparison. The Blob API returns etags unquoted, but
 * HTTP ETag/If-Match headers are conventionally quoted (and Vercel's edge
 * quotes them when serving). The UI echoes back whatever the ETag header
 * carried, so comparisons must be quote-insensitive or every conditional
 * write fails with revision_conflict.
 */
export function normalizeEtag(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

export type Vehicle = {
  id: string;
  vin?: string;
  year: number;
  make: string;
  model: string;
  price: number;
  mileage: number;
  condition: string;
  description: string;
  status: "available" | "sold" | "pending";
  photos: string[];
  createdAt: string;
} & VehicleDetails;


const catalogPath = "inventory/inventory.json";

const browserFixture: Vehicle = {
  id: "e2e-honda-civic",
  year: 2022,
  make: "Honda",
  model: "Civic",
  price: 18_000,
  mileage: 32_000,
  condition: "Used",
  description: "Synthetic browser-test inventory fixture.",
  trim: "EX",
  bodyStyle: "Sedan",
  exteriorColor: "Silver",
  status: "available",
  photos: [],
  createdAt: "2026-09-09T00:00:00.000Z",
};

function readBrowserFixture(): Vehicle[] | null {
  if (process.env.SPEEDZONE_E2E !== "1" || process.env.VERCEL) return null;
  const mode = process.env.INVENTORY_E2E_FIXTURE;
  if (!mode) return null;
  if (mode === "failure") throw new Error("Synthetic inventory storage failure");
  return mode === "empty" ? [] : [browserFixture];
}

export async function readInventory(): Promise<Vehicle[]> {
  return (await readInventorySnapshot()).vehicles;
}

export async function readInventorySnapshot(): Promise<{ vehicles: Vehicle[]; revision: string }> {
  const fixture = readBrowserFixture();
  if (fixture) return { vehicles: fixture, revision: "fixture" };
  const current = await getRedis()?.get<{ version: number; revision: string; vehicles: Vehicle[] }>(inventoryStateKey);
  if (current) {
    if (current.version !== 2 || typeof current.revision !== "string" || !validInventory(current.vehicles)) throw new Error("Invalid inventory state");
    return { vehicles: current.vehicles, revision: current.revision };
  }
  // Keep legacy listings visible during a controlled migration, but never use
  // a CDN snapshot as the basis of an authoritative edit or destructive cleanup.
  const result = await get(catalogPath, { access: "public" });
  if (!result) return { vehicles: [], revision: "legacy-read-only" };
  if (result.statusCode !== 200 || !result.blob.etag) throw new Error("Unable to read inventory catalog");
  const data: unknown = await new Response(result.stream).json();
  if (!validInventory(data)) {
    throw new Error("Invalid inventory catalog; refusing to overwrite it");
  }
  return { vehicles: data, revision: "legacy-read-only" };
}

export function validInventory(data: unknown): data is Vehicle[] {
  return Array.isArray(data) && data.length <= 500 && data.every(item => item && typeof item.id === "string" && Array.isArray(item.photos)
    && item.photos.length <= maxInventoryPhotoCount && item.photos.every((url: unknown) => typeof url === "string")
    && vehicleDetailKeys.every(key => validDetail(key, item[key])));
}
export class InventoryReadOnlyError extends Error {
  constructor() { super("Inventory is temporarily read-only. Please contact the site administrator."); }
}

export async function writeInventory(vehicles: Vehicle[], revision: string) {
  const redis = getRedis();
  if (!redis || revision === "legacy-read-only" || !revision) throw new InventoryReadOnlyError();
  if (!validInventory(vehicles)) throw new Error("Invalid inventory");
  vehicles = vehicles.map(vehicle => ({ ...vehicle, photos: vehicle.photos.map(canonicalInventoryPhotoUrl) }));
  const nextRevision = randomUUID();
  const document = JSON.stringify({ version: 2, revision: nextRevision, vehicles });
  if (Buffer.byteLength(document) > 512 * 1024) throw new Error("Inventory is too large");
  // Immutable public-data backups are written before committing the pointer.
  // A rejected concurrent write may leave an unused backup, never lost data.
  await put(`inventory/history/${nextRevision}.json`, document, {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 31536000,
    allowOverwrite: false,
  });
  const photoKeys = [...new Set(vehicles.flatMap(vehicle => vehicle.photos))].map(inventoryPhotoStateKey);
  const result = Number(await redis.eval(inventoryCommitScript, [inventoryStateKey, ...photoKeys], [revision, document]));
  if (result === -1) throw new Error("A selected photo is no longer available. Upload it again.");
  if (result !== 1) throw new BlobPreconditionFailedError();
  // Covers create, edit, delete, photo changes and DealerCenter imports, which
  // all commit through this function.
  invalidatePublicInventory();
  return { etag: nextRevision };
}

export function sanitizeVehicleInput(input: Record<string, unknown>, photos: string[] = []): Vehicle {
  const year = Number(input.year);
  const price = Number(input.price);
  const mileage = Number(input.mileage);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error("Enter a valid year");
  if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid price");
  if (!Number.isFinite(mileage) || mileage < 0) throw new Error("Enter valid mileage");
  const text = (key: string) => String(input[key] ?? "").trim();
  const vin = text("vin").toUpperCase();
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error("Enter a valid 17-character VIN");
  const make = text("make");
  const model = text("model");
  if (!make || !model) throw new Error("Make and model are required");
  return {
    id: text("id") || crypto.randomUUID(), vin, year, make, model, price, mileage,
    condition: text("condition") || "Used", description: text("description"),
    status: input.status === "sold" || input.status === "pending" ? input.status : "available",
    photos, createdAt: text("createdAt") || new Date().toISOString(),
    ...sanitizeVehicleDetails(input),
  };
}

export function appendVehiclePhotos(vehicles: Vehicle[], id: string, photos: string[]) {
  const vehicleIndex = vehicles.findIndex((vehicle) => vehicle.id === id);
  if (vehicleIndex === -1) throw new Error("Vehicle not found");

  const vehicle = vehicles[vehicleIndex];
  if (!vehicle) throw new Error("Vehicle not found");
  if (vehicle.photos.length + photos.length > maxInventoryPhotoCount) {
    throw new Error(`A listing can have no more than ${maxInventoryPhotoCount} photos`);
  }

  const updatedVehicle = { ...vehicle, photos: [...vehicle.photos, ...photos] };
  return {
    vehicle: updatedVehicle,
    inventory: vehicles.map((item, index) => index === vehicleIndex ? updatedVehicle : item),
  };
}
