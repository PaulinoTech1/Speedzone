import { describe, expect, it } from "vitest";
import { buildVehicleFeedCsv } from "@/lib/integrations/meta/vehicle-feed";
import { publicPhotos, vehicleStructuredData } from "@/lib/vehicle-structured-data";
import type { Vehicle } from "@/lib/inventory";

const car: Vehicle = { id: "abc", vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", price: 1, mileage: 1, condition: "Used", description: "", status: "available", photos: ["http://insecure.example/a.jpg", "https://store.public.blob.vercel-storage.com/inventory/a.webp", "//proto-relative.example/b.jpg"], createdAt: "2026-10-01T00:00:00.000Z" };

describe("no plaintext URLs leave the integrations (MITM)", () => {
  it("feed, JSON-LD and OG photos contain only https URLs", () => {
    const csv = buildVehicleFeedCsv([car]);
    expect(csv).not.toMatch(/http:\/\/|"\/\//);
    expect(JSON.stringify(vehicleStructuredData(car))).not.toMatch(/http:\/\//);
    expect(publicPhotos(car)).toEqual([car.photos[1]]);
  });
});
