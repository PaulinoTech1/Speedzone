import { describe, expect, it } from "vitest";

import { appendVehiclePhotos, type Vehicle } from "@/lib/inventory";
import { maxInventoryPhotoCount } from "@/lib/inventory-photos";

const firstVehicle: Vehicle = {
  id: "first",
  year: 2022,
  make: "Honda",
  model: "Civic",
  price: 18000,
  mileage: 32000,
  condition: "Used",
  description: "",
  status: "available",
  photos: ["old-front.webp"],
  createdAt: "2026-09-09T00:00:00.000Z",
};

const secondVehicle: Vehicle = {
  ...firstVehicle,
  id: "second",
  make: "Toyota",
  photos: [],
};

describe("appendVehiclePhotos", () => {
  it("appends several photos in upload order without replacing existing photos", () => {
    const result = appendVehiclePhotos(
      [firstVehicle, secondVehicle],
      firstVehicle.id,
      ["new-side.webp", "new-rear.webp"],
    );

    expect(result.vehicle.photos).toEqual([
      "old-front.webp",
      "new-side.webp",
      "new-rear.webp",
    ]);
    expect(result.inventory[1]).toBe(secondVehicle);
    expect(firstVehicle.photos).toEqual(["old-front.webp"]);
  });

  it("rejects updates that would exceed the per-listing photo limit", () => {
    const fullVehicle = {
      ...firstVehicle,
      photos: Array.from({ length: maxInventoryPhotoCount }, (_, index) => `${index}.webp`),
    };

    expect(() => appendVehiclePhotos([fullVehicle], fullVehicle.id, ["extra.webp"]))
      .toThrow(`A listing can have no more than ${maxInventoryPhotoCount} photos`);
  });

  it("rejects an unknown vehicle id", () => {
    expect(() => appendVehiclePhotos([firstVehicle], "missing", ["new.webp"]))
      .toThrow("Vehicle not found");
  });
});
