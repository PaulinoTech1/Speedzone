import { describe, expect, it } from "vitest";
import { sanitizeVehicleInput, validInventory, vehiclePath } from "../src/lib/inventory";

const base = { year: 2021, make: "Toyota", model: "RAV4", price: 24000, mileage: 41000 };

describe("optional vehicle details", () => {
  it("keeps legacy listings without details valid and unchanged in shape", () => {
    const saved = sanitizeVehicleInput(base);
    expect(saved).not.toHaveProperty("bodyStyle");
    expect(validInventory([{ ...saved, photos: [] }])).toBe(true);
  });

  it("normalizes and stores catalog details", () => {
    const saved = sanitizeVehicleInput({ ...base, stockNumber: " sz-104 ", trim: "XLE  Premium", bodyStyle: "SUV", exteriorColor: "Blueprint", transmission: "Automatic", drivetrain: "AWD", fuelType: "Gasoline" });
    expect(saved).toMatchObject({ stockNumber: "SZ-104", trim: "XLE Premium", bodyStyle: "SUV", drivetrain: "AWD" });
  });

  it("treats empty strings as cleared", () => {
    expect(sanitizeVehicleInput({ ...base, trim: "", bodyStyle: "" })).not.toHaveProperty("trim");
  });

  it.each([
    ["bodyStyle", "Spaceship"], ["transmission", "Semi"], ["stockNumber", "SZ 104!"], ["trim", "<script>"], ["exteriorColor", "x".repeat(41)],
  ])("rejects invalid %s", (key, value) => {
    expect(() => sanitizeVehicleInput({ ...base, [key]: value })).toThrow(/Enter a valid/);
  });

  it("rejects stored catalogs with tampered details", () => {
    expect(validInventory([{ ...sanitizeVehicleInput(base), photos: [], bodyStyle: "Spaceship" }])).toBe(false);
  });

  it("builds a stable, encoded detail path from the id", () => {
    expect(vehiclePath({ id: "e2e-honda-civic" })).toBe("/inventory/e2e-honda-civic");
  });
});
