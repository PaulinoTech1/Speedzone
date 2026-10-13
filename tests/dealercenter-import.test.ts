import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, CsvError } from "../src/lib/integrations/dealercenter/csv";
import { normalizeEnum, parseMappingOverride, resolveColumns } from "../src/lib/integrations/dealercenter/mapping";
import { planInventoryImport } from "../src/lib/integrations/dealercenter/import";
import type { Vehicle } from "../src/lib/inventory";

// Synthetic fixture: fake VINs, fake people. Never commit a real export.
const sample = readFileSync(new URL("./fixtures/dealercenter-sample.synthetic.csv", import.meta.url), "utf8");
const now = "2026-10-13T12:00:00.000Z";
const existing = (overrides: Partial<Vehicle>): Vehicle => ({ id: crypto.randomUUID(), year: 2019, make: "Honda", model: "Accord", price: 19995, mileage: 48000, condition: "Used", description: "Site description", status: "available", photos: ["https://store.public.blob.vercel-storage.com/inventory/a.webp"], createdAt: "2026-01-01T00:00:00.000Z", ...overrides });

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('\ufeffa,b\r\n"x, ""y""",2\r\n')).toEqual([["a", "b"], ['x, "y"', "2"]]);
  });
  it("detects tab-delimited files", () => { expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]); });
  it("rejects unterminated quotes and oversize input", () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
    expect(() => parseCsv("x".repeat(1024 * 1024 + 1))).toThrow(/1 MB/);
  });
  it("never interprets spreadsheet formulas", () => { expect(parseCsv("a\n=HYPERLINK(1)")[1]).toEqual(["=HYPERLINK(1)"]); });
});

describe("column mapping", () => {
  it("maps default aliases and discards customer/cost columns unread", () => {
    const { columns, blocked } = resolveColumns(parseCsv(sample)[0]!);
    expect(columns.stockNumber).toBe(0);
    expect(columns.exteriorColor).toBe(7);
    expect(blocked).toEqual(["Customer Name", "Customer Phone", "Cost", "Notes"]);
  });
  it("rejects overrides that target blocked columns or unknown fields", () => {
    expect(() => parseMappingOverride({ description: ["Customer Name"] })).toThrow(/blocked/);
    expect(() => parseMappingOverride({ ssn: ["x"] })).toThrow(/Unknown/);
    expect(parseMappingOverride({ price: "Web Price" })?.price).toEqual(["Web Price"]);
  });
  it.each([["bodyStyle", "Crew Cab Pickup", "Truck"], ["bodyStyle", "4dr Sedan", "Sedan"], ["drivetrain", "4x4", "4WD"], ["transmission", "Automatic CVT", "CVT"], ["fuelType", "Gas", "Gasoline"]] as const)("normalizes %s %s", (field, raw, expected) => {
    expect(normalizeEnum(field, raw)).toBe(expected);
  });
});

describe("import planning", () => {
  it("adds new vehicles from the synthetic export without any PII", () => {
    const { diff, next } = planInventoryImport(sample, [], { fullImport: false, now });
    expect(diff.added).toHaveLength(3);
    expect(diff.errors).toEqual([]);
    expect(diff.externalPhotoUrls).toBe(2);
    const accord = next.find(v => v.vin === "1HGCM82633A004352")!;
    expect(accord).toMatchObject({ stockNumber: "SYN-001", price: 18995, mileage: 48210, bodyStyle: "Sedan", transmission: "CVT", photos: [] });
    expect(next.find(v => v.stockNumber === "SYN-002")?.status).toBe("pending");
    expect(JSON.stringify({ diff, next })).not.toMatch(/Jane|555-0100|12000|do not import/);
  });

  it("upserts by VIN, falls back to stock number, and preserves site-owned fields", () => {
    const accord = existing({ vin: "1HGCM82633A004352" });
    const ford = existing({ make: "Ford", model: "F-150", year: 2016, stockNumber: "SYN-003", price: 23995, mileage: 91500 });
    const { diff, next } = planInventoryImport(sample, [accord, ford], { fullImport: false, now });
    expect(diff.added.map(a => a.key)).toEqual(["VIN 2T3W1RFV8KW000001"]);
    const updatedAccord = next.find(v => v.id === accord.id)!;
    expect(updatedAccord).toMatchObject({ price: 18995, photos: accord.photos, createdAt: accord.createdAt });
    expect(next.find(v => v.id === ford.id)?.price).toBe(22995);
    expect(diff.updated.find(u => u.key === "VIN 1HGCM82633A004352")?.fields).toContain("price");
  });

  it("marks vehicles missing from a full import as sold, never deletes, and leaves manual listings alone", () => {
    const gone = existing({ vin: "JTDKN3DU0A0000001", make: "Toyota", model: "Prius" });
    const manual = existing({ make: "Mazda", model: "3" });
    const { diff, next } = planInventoryImport(sample, [gone, manual], { fullImport: true, now });
    expect(next).toHaveLength(5);
    expect(next.find(v => v.id === gone.id)?.status).toBe("sold");
    expect(next.find(v => v.id === manual.id)?.status).toBe("available");
    expect(diff.removed).toEqual([{ key: "VIN JTDKN3DU0A0000001", title: "2019 Toyota Prius" }]);
    expect(diff.untouchedManual).toBe(1);
    expect(planInventoryImport(sample, [gone], { fullImport: false, now }).diff.removed).toEqual([]);
  });

  it("reports row errors and duplicates instead of guessing", () => {
    const csv = "VIN,Year,Make,Model,Price,Mileage\n1HGCM82633A004352,2019,Honda,Accord,,10\n1HGCM82633A004352,2019,Honda,Accord,1,10\n1HGCM82633A004352,2019,Honda,Accord,1,10\nBADVIN,2019,Honda,Accord,1,10";
    const { diff } = planInventoryImport(csv, [], { fullImport: false, now });
    expect(diff.errors.map(e => e.row)).toEqual([2, 4, 5]);
    expect(diff.errors[1]?.message).toMatch(/Duplicate/);
  });

  it("requires core and identifier columns", () => {
    expect(() => planInventoryImport("VIN,Make\nX,Y", [], { fullImport: false })).toThrow(/Required columns/);
    expect(() => planInventoryImport("Year,Make,Model,Price,Mileage\n2019,a,b,1,1", [], { fullImport: false })).toThrow(/VIN or stock number/);
  });

  it("produces a stable digest bound to file and options", () => {
    const a = planInventoryImport(sample, [], { fullImport: false, now }).diff.digest;
    expect(planInventoryImport(sample, [], { fullImport: false, now }).diff.digest).toBe(a);
    expect(planInventoryImport(sample, [], { fullImport: true, now }).diff.digest).not.toBe(a);
  });
});
