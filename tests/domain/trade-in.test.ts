import { describe, expect, it } from "vitest";

import { tradeInRequestSchema } from "@/lib/domain/trade-in";

function submission(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Jamie Rivera",
    email: "jamie@example.com",
    phone: "(508) 826-9405",
    vin: "",
    year: 2019,
    make: "Toyota",
    model: "Camry",
    trim: "SE",
    bodyStyle: "",
    engine: "",
    transmission: "",
    drivetrain: "",
    fuelType: "",
    mileage: 45000,
    condition: "good",
    comments: "Clean title, one owner.",
    website: "",
    ...overrides,
  };
}

describe("tradeInRequestSchema", () => {
  it("accepts a complete submission without a VIN", () => {
    const result = tradeInRequestSchema.safeParse(submission());
    expect(result.success).toBe(true);
  });

  it("accepts a valid VIN, uppercasing it", () => {
    const result = tradeInRequestSchema.safeParse(submission({ vin: "1hgcm82633a004352" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.vin).toBe("1HGCM82633A004352");
  });

  it.each([
    ["missing full name", { fullName: "" }],
    ["missing email", { email: "" }],
    ["invalid email", { email: "not-an-email" }],
    ["invalid phone", { phone: "abc" }],
    ["a VIN that is too short", { vin: "1HGCM8263" }],
    ["a VIN with an invalid character", { vin: "1HGCM82633A00435I" }],
    ["missing make", { make: "" }],
    ["missing model", { model: "" }],
    ["a negative mileage", { mileage: -1 }],
    ["a year before cars existed", { year: 1800 }],
    ["an invalid condition", { condition: "mint" }],
  ])("rejects %s", (_name, overrides) => {
    const result = tradeInRequestSchema.safeParse(submission(overrides));
    expect(result.success).toBe(false);
  });

  it("rejects a filled-in honeypot field", () => {
    const result = tradeInRequestSchema.safeParse(submission({ website: "http://spam.example" }));
    expect(result.success).toBe(false);
  });

  it("rejects unexpected extra fields", () => {
    const result = tradeInRequestSchema.safeParse(submission({ financingRequested: true }));
    expect(result.success).toBe(false);
  });

  it("defaults optional decoded-spec fields to empty strings", () => {
    const { bodyStyle, engine, transmission, drivetrain, fuelType, trim, comments, ...rest } =
      submission();
    void bodyStyle;
    void engine;
    void transmission;
    void drivetrain;
    void fuelType;
    void trim;
    void comments;
    const result = tradeInRequestSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trim).toBe("");
      expect(result.data.engine).toBe("");
      expect(result.data.comments).toBe("");
    }
  });
});
