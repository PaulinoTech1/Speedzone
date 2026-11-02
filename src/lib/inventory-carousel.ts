import type { Vehicle } from "@/lib/inventory";

/**
 * One slide in the home page inventory carousel: an available vehicle with a
 * photo to show. This is the single place that decides what the carousel may
 * display, so the home page, the tests, and the weekly freshness check all
 * enforce the same rule: available status AND at least one photo.
 */
export type InventorySlide = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  price: number;
  mileage: number;
  photo: string;
};

export function toInventorySlides(vehicles: Vehicle[]): InventorySlide[] {
  return vehicles
    .filter(
      (vehicle) => vehicle.status === "available" && vehicle.photos.length > 0,
    )
    .map((vehicle) => ({
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim ?? null,
      price: vehicle.price,
      mileage: vehicle.mileage,
      // First photo is the listing's primary photo; the detail page shows the rest.
      photo: vehicle.photos[0] as string,
    }));
}
