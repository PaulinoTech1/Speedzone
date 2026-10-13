import { createHash, randomUUID } from "node:crypto";
import { sanitizeVehicleInput, type Vehicle } from "@/lib/inventory";
import { vehicleDetailKeys } from "@/lib/vehicle-details";
import { parseCsv } from "./csv";
import { normalizeEnum, normalizeStatus, parseNumber, resolveColumns, splitPhotoUrls, type ColumnMapping, type ImportField } from "./mapping";

export type ImportRowError = { row: number; key?: string; message: string };
export type ImportDiff = {
  digest: string;
  fullImport: boolean;
  columns: { mapped: Partial<Record<ImportField, string>>; blocked: string[]; ignored: string[] };
  added: Array<{ key: string; title: string }>;
  updated: Array<{ key: string; title: string; fields: string[] }>;
  removed: Array<{ key: string; title: string }>;
  unchanged: number;
  untouchedManual: number;
  externalPhotoUrls: number;
  errors: ImportRowError[];
  warnings: string[];
};

const comparable = ["year", "make", "model", "price", "mileage", "status", "description", "vin", ...vehicleDetailKeys] as const;
const keyOf = (vehicle: Pick<Vehicle, "vin" | "stockNumber">) => vehicle.vin ? `vin:${vehicle.vin}` : vehicle.stockNumber ? `stock:${vehicle.stockNumber}` : null;
const titleOf = (vehicle: Pick<Vehicle, "year" | "make" | "model">) => `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
const displayKey = (key: string) => key.replace(/^vin:/, "VIN ").replace(/^stock:/, "Stock ");

/** Digest binds an apply request to the exact file and options that were previewed. */
export function importDigest(csv: string, fullImport: boolean, mapping: ColumnMapping | null) {
  return createHash("sha256").update(JSON.stringify([csv, fullImport, mapping])).digest("hex");
}

/**
 * Pure planning step: parse, map, and diff an export against the current
 * catalog. Nothing is persisted; the caller decides whether to commit `next`.
 */
export function planInventoryImport(csv: string, current: Vehicle[], options: { fullImport: boolean; mapping?: ColumnMapping | null; now?: string }) {
  const rows = parseCsv(csv);
  const [headers, ...records] = rows;
  if (!headers || records.length === 0) throw new Error("The file has no vehicle rows");
  const { columns, blocked, ignored } = resolveColumns(headers, options.mapping ?? undefined);
  const missing = (["year", "make", "model", "price", "mileage"] as const).filter(field => columns[field] === undefined);
  if (missing.length) throw new Error(`Required columns not found: ${missing.join(", ")}. Check the column mapping.`);
  if (columns.vin === undefined && columns.stockNumber === undefined) throw new Error("A VIN or stock number column is required to match vehicles");

  const diff: ImportDiff = {
    digest: importDigest(csv, options.fullImport, options.mapping ?? null), fullImport: options.fullImport,
    columns: { mapped: Object.fromEntries(Object.entries(columns).map(([field, index]) => [field, headers[index!]])), blocked, ignored },
    added: [], updated: [], removed: [], unchanged: 0, untouchedManual: 0, externalPhotoUrls: 0, errors: [], warnings: [],
  };
  if (blocked.length) diff.warnings.push(`${blocked.length} customer or cost column(s) were discarded without being read.`);

  const byKey = new Map<string, Vehicle>();
  for (const vehicle of current) {
    if (vehicle.vin) byKey.set(`vin:${vehicle.vin}`, vehicle);
    if (vehicle.stockNumber && !byKey.has(`stock:${vehicle.stockNumber}`)) byKey.set(`stock:${vehicle.stockNumber}`, vehicle);
  }
  const seen = new Set<string>();
  const replacements = new Map<string, Vehicle>();
  const additions: Vehicle[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const cell = (field: ImportField) => columns[field] === undefined ? "" : (record[columns[field]!] ?? "").trim();
    try {
      const raw: Record<string, unknown> = {
        vin: cell("vin"), stockNumber: cell("stockNumber"), year: parseNumber(cell("year")), make: cell("make"), model: cell("model"),
        trim: cell("trim"), exteriorColor: cell("exteriorColor"), interiorColor: cell("interiorColor"),
        mileage: parseNumber(cell("mileage")), price: parseNumber(cell("price")), status: normalizeStatus(cell("status")),
      };
      for (const field of ["year", "price", "mileage"] as const) if (raw[field] === null) throw new Error(`Missing or invalid ${field}`);
      for (const field of ["bodyStyle", "transmission", "drivetrain", "fuelType"] as const) {
        const value = cell(field);
        const mapped = normalizeEnum(field, value);
        if (value && !mapped) diff.warnings.push(`Row ${rowNumber}: unrecognized ${field} "${value.slice(0, 30)}" was left blank.`);
        raw[field] = mapped ?? "";
      }
      for (const field of ["trim", "exteriorColor", "interiorColor"] as const) raw[field] = String(raw[field]).slice(0, 40);
      const description = cell("description").slice(0, 2000);
      const candidate = sanitizeVehicleInput({ ...raw, description, id: "pending", createdAt: options.now });
      const key = keyOf(candidate);
      if (!key) throw new Error("VIN or stock number is required");
      if (seen.has(key)) throw new Error(`Duplicate ${displayKey(key)} in file`);
      seen.add(key);
      diff.externalPhotoUrls += splitPhotoUrls(cell("photos")).length;

      const existing = byKey.get(key) ?? (candidate.vin && candidate.stockNumber ? byKey.get(`stock:${candidate.stockNumber}`) : undefined);
      if (!existing) {
        const vehicle = { ...candidate, id: randomUUID(), createdAt: options.now ?? new Date().toISOString() };
        additions.push(vehicle);
        diff.added.push({ key: displayKey(key), title: titleOf(vehicle) });
        return;
      }
      if (existing.vin) seen.add(`vin:${existing.vin}`);
      if (existing.stockNumber) seen.add(`stock:${existing.stockNumber}`);
      // DealerCenter owns the core fields; the site keeps its id, photos,
      // creation time, and its own description when the export has none.
      const next: Vehicle = { ...candidate, id: existing.id, createdAt: existing.createdAt, photos: existing.photos, description: description || existing.description, condition: existing.condition };
      const fields = comparable.filter(field => (existing[field] ?? "") !== (next[field] ?? ""));
      if (fields.length) { replacements.set(existing.id, next); diff.updated.push({ key: displayKey(key), title: titleOf(next), fields }); }
      else diff.unchanged++;
    } catch (error) {
      diff.errors.push({ row: rowNumber, key: (cell("vin") || cell("stockNumber")).slice(0, 20) || undefined, message: error instanceof Error ? error.message : "Invalid row" });
    }
  });

  const next = current.map(vehicle => {
    const replacement = replacements.get(vehicle.id);
    if (replacement) return replacement;
    const key = keyOf(vehicle);
    if (!key) { diff.untouchedManual++; return vehicle; }
    const present = (vehicle.vin && seen.has(`vin:${vehicle.vin}`)) || (vehicle.stockNumber && seen.has(`stock:${vehicle.stockNumber}`));
    // Full imports never delete: missing vehicles are marked sold so their
    // stable URL and photos survive for review.
    if (options.fullImport && !present && vehicle.status !== "sold") {
      diff.removed.push({ key: displayKey(key), title: titleOf(vehicle) });
      return { ...vehicle, status: "sold" as const };
    }
    return vehicle;
  });
  if (diff.externalPhotoUrls) diff.warnings.push(`${diff.externalPhotoUrls} photo URL(s) found. Photos are not imported yet; existing site photos are kept.`);
  if (diff.warnings.length > 50) diff.warnings = [...diff.warnings.slice(0, 50), `${diff.warnings.length - 50} more warning(s) not shown.`];
  return { diff, next: [...additions, ...next] };
}
