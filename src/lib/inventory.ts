import { BlobNotFoundError, get, head, put } from "@vercel/blob";
import { maxInventoryPhotoCount } from "@/lib/inventory-photos";

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
};

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
  // Use the authoritative Blob API etag for the revision, not the CDN etag from
  // get(). The put() x-if-match precondition is evaluated against the API's
  // etag; the CDN etag can be stale or transformed, which makes every
  // conditional write fail. Fall back to the CDN etag only if head() is
  // unavailable so reads keep working.
  let apiRevision: string | null = null;
  try {
    const metadata = await head(catalogPath);
    apiRevision = metadata.etag || null;
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      const result = await get(catalogPath, { access: "public" });
      if (!result || result.statusCode !== 200) return { vehicles: [], revision: "absent" };
      // Blob API says absent but CDN still serves a copy; treat the API as
      // authoritative for writes but keep serving the readable copy.
    } else {
      console.warn("[inventory] blob head() failed; falling back to CDN etag", error);
    }
  }
  const result = await get(catalogPath, { access: "public" });
  if (!result) return { vehicles: [], revision: "absent" };
  if (result.statusCode !== 200 || !result.blob.etag) throw new Error("Unable to read inventory catalog");
  const data: unknown = await new Response(result.stream).json();
  if (!Array.isArray(data) || data.some(item => !item || typeof item.id !== "string" || !Array.isArray(item.photos))) {
    throw new Error("Invalid inventory catalog; refusing to overwrite it");
  }
  return { vehicles: data as Vehicle[], revision: apiRevision || result.blob.etag };
}

export async function writeInventory(vehicles: Vehicle[], revision: string) {
  if (!revision) throw new Error("Inventory revision is required");
  return put(catalogPath, JSON.stringify(vehicles, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    allowOverwrite: revision !== "absent",
    ...(revision === "absent" ? {} : { ifMatch: revision }),
  });
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
