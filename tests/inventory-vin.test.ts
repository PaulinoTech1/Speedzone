import { expect, it } from "vitest";
import { sanitizeVehicleInput } from "../src/lib/inventory";
const vehicle = { year: 2022, make: "Honda", model: "Civic", price: 18000, mileage: 32000 };
it("normalizes and preserves a VIN through serialization", () => {
  const saved = sanitizeVehicleInput({ ...vehicle, vin: " 1hgcm82633a004352 " });
  expect(JSON.parse(JSON.stringify(saved)).vin).toBe("1HGCM82633A004352");
});
it("allows existing vehicles without a VIN", () => {
  expect(sanitizeVehicleInput(vehicle).vin).toBe("");
});
it.each(["123", "1HGCM82633A00435I", "1HGCM82633A00435O", "1HGCM82633A00435Q"])("rejects malformed VIN %s", vin => {
  expect(() => sanitizeVehicleInput({ ...vehicle, vin })).toThrow("17-character VIN");
});
