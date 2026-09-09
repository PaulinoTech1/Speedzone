import { list, put } from "@vercel/blob";
import { maxInventoryPhotoCount } from "@/lib/inventory-photos";

export type Vehicle = {
  id: string;
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

export async function readInventory(): Promise<Vehicle[]> {
  const { blobs } = await list({ prefix: catalogPath, limit: 1 });
  const catalog = blobs.find((blob) => blob.pathname === catalogPath);
  if (!catalog) return [];
  const response = await fetch(catalog.url, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to read inventory catalog");
  const data = await response.json();
  return Array.isArray(data) ? (data as Vehicle[]) : [];
}

export async function writeInventory(vehicles: Vehicle[]) {
  return put(catalogPath, JSON.stringify(vehicles, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: true,
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
  const make = text("make");
  const model = text("model");
  if (!make || !model) throw new Error("Make and model are required");
  return {
    id: text("id") || crypto.randomUUID(), year, make, model, price, mileage,
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
