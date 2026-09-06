import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canTransitionVehicle,
  vehicleInputSchema,
  vehiclePhotoSchema,
} from "@/lib/domain/vehicle";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    stockNumber: "SZ-100",
    vin: "1HGCM82633A004352",
    year: 2022,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    price: 18900,
    mileage: 42000,
    exteriorColor: "Black",
    interiorColor: "Gray",
    bodyStyle: "Sedan",
    transmission: "Automatic",
    drivetrain: "FWD",
    fuelType: "Gasoline",
    engine: "1.5L",
    description: "Clean commuter",
    features: ["Bluetooth"],
    status: "draft",
    slug: "2022-honda-accord",
    photographs: [],
    ...overrides,
  };
}

describe("vehicle validation and rendering", () => {
  it("enforces the intended lifecycle transitions", () => {
    expect(canTransitionVehicle("draft", "published")).toBe(true);
    expect(canTransitionVehicle("published", "sold")).toBe(true);
    expect(canTransitionVehicle("sold", "draft")).toBe(false);
    expect(canTransitionVehicle("archived", "draft")).toBe(true);
  });

  it("requires a photograph before publication", () => {
    expect(vehicleInputSchema.safeParse(draft({ status: "published" })).success).toBe(false);
  });

  it("allows a missing VIN for inventory records", () => {
    const result = vehicleInputSchema.safeParse(draft({ vin: "" }));
    expect(result.success).toBe(true);
  });

  it("rejects oversized photo metadata", () => {
    const result = vehiclePhotoSchema.safeParse({
      url: "https://store.public.blob.vercel-storage.com/a.webp",
      pathname: "vehicles/a.webp",
      width: 1600,
      height: 1200,
      bytes: 4 * 1024 * 1024 + 1,
      alt: "Car",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("keeps descriptions as text and React escapes stored-XSS payloads", () => {
    const payload = `<img src=x onerror=alert(1)><script>alert(1)</script>`;
    const parsed = vehicleInputSchema.parse(draft({ description: payload }));
    const markup = renderToStaticMarkup(<p>{parsed.description}</p>);
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;");
  });
});
