import { describe, expect, it } from "vitest";
import { serializeJsonLd, vehicleStructuredData } from "../src/lib/vehicle-structured-data";
import type { Vehicle } from "../src/lib/inventory";

const vehicle: Vehicle = { id: "abc-123", vin: "1HGCM82633A004352", stockNumber: "SZ-1", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", bodyStyle: "Sedan", exteriorColor: "Silver", drivetrain: "FWD", fuelType: "Gasoline", price: 18995, mileage: 48210, condition: "Used", description: "Clean </script><script>alert(1)</script>", status: "available", photos: ["https://store.public.blob.vercel-storage.com/inventory/a.webp", "javascript:alert(1)"], createdAt: "2026-10-01T00:00:00.000Z" };

describe("vehicle structured data", () => {
  it("maps a listing to schema.org Car with an Offer", () => {
    const data = vehicleStructuredData(vehicle);
    expect(data).toMatchObject({ "@type": "Car", name: "2019 Honda Accord EX-L", vehicleIdentificationNumber: vehicle.vin, bodyType: "Sedan", mileageFromOdometer: { value: 48210, unitCode: "SMI" }, driveWheelConfiguration: "https://schema.org/FrontWheelDriveConfiguration", offers: { price: 18995, priceCurrency: "USD", availability: "https://schema.org/InStock" }, url: "https://www.speedzonems.com/inventory/abc-123" });
    expect(data.image).toEqual([vehicle.photos[0]]);
  });
  it("marks sold and pending availability and omits empty optional fields", () => {
    const sold = vehicleStructuredData({ ...vehicle, status: "sold", vin: "", trim: undefined, photos: [] });
    expect(sold.offers.availability).toBe("https://schema.org/SoldOut");
    expect(sold).not.toHaveProperty("vehicleIdentificationNumber");
    expect(sold).not.toHaveProperty("image");
    expect(vehicleStructuredData({ ...vehicle, status: "pending" }).offers.availability).toBe("https://schema.org/LimitedAvailability");
  });
  it("serializes without any sequence that could close the script element", () => {
    const json = serializeJsonLd(vehicleStructuredData(vehicle));
    expect(json).not.toMatch(/<|>/);
    expect(JSON.parse(json).description).toContain("</script>");
  });
});
