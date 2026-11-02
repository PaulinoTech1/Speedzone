import { describe, expect, it } from "vitest";

import { toInventorySlides } from "@/lib/inventory-carousel";
import type { Vehicle } from "@/lib/inventory";

function vehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: "vehicle-1",
    year: 2016,
    make: "Chevrolet",
    model: "Equinox",
    price: 6799,
    mileage: 91000,
    condition: "Used",
    description: "Test vehicle.",
    status: "available",
    photos: ["https://example.invalid/photo-1.jpg"],
    createdAt: "2026-10-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("toInventorySlides", () => {
  it("keeps available vehicles with photos, using the first photo", () => {
    const slides = toInventorySlides([
      vehicle({
        id: "v-1",
        photos: [
          "https://example.invalid/first.jpg",
          "https://example.invalid/second.jpg",
        ],
      }),
    ]);
    expect(slides).toEqual([
      {
        id: "v-1",
        year: 2016,
        make: "Chevrolet",
        model: "Equinox",
        trim: null,
        price: 6799,
        mileage: 91000,
        photo: "https://example.invalid/first.jpg",
      },
    ]);
  });

  it("drops sold and pending vehicles", () => {
    const slides = toInventorySlides([
      vehicle({ id: "sold", status: "sold" }),
      vehicle({ id: "pending", status: "pending" }),
      vehicle({ id: "available" }),
    ]);
    expect(slides.map((slide) => slide.id)).toEqual(["available"]);
  });

  it("drops available vehicles with no photos", () => {
    const slides = toInventorySlides([vehicle({ photos: [] })]);
    expect(slides).toEqual([]);
  });

  it("preserves listing order and carries trim when present", () => {
    const slides = toInventorySlides([
      vehicle({ id: "a", trim: "LT" }),
      vehicle({ id: "b" }),
    ]);
    expect(slides.map((slide) => slide.id)).toEqual(["a", "b"]);
    expect(slides[0]?.trim).toBe("LT");
    expect(slides[1]?.trim).toBeNull();
  });

  it("returns an empty list for empty inventory", () => {
    expect(toInventorySlides([])).toEqual([]);
  });
});
