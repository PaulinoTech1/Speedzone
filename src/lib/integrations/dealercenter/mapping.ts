import { bodyStyles, drivetrains, fuelTypes, transmissions, type VehicleDetails } from "@/lib/vehicle-details";

/**
 * Target fields an inventory export can populate. Photos are collected for
 * reporting only: the site serves photos exclusively from its own Blob store,
 * so external DealerCenter image URLs are never written into the catalog.
 */
export const importFields = ["vin", "stockNumber", "year", "make", "model", "trim", "bodyStyle", "exteriorColor", "interiorColor", "transmission", "drivetrain", "fuelType", "mileage", "price", "description", "status", "photos"] as const;
export type ImportField = (typeof importFields)[number];
export type ColumnMapping = Partial<Record<ImportField, string[]>>;

export const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * DEFAULT MAPPING - TO BE CONFIRMED against a real SpeedZone DealerCenter
 * export. DealerCenter does not publish its feed column names. These aliases
 * cover the common names seen in dealer website/syndication CSV feeds
 * (StockNumber, VIN, Year, Make, Model, Trim, Mileage, Price, ImageURLs...)
 * and are matched case- and punctuation-insensitively.
 */
export const defaultDealerCenterMapping: Required<ColumnMapping> = {
  vin: ["VIN", "VIN Number", "VehicleVIN"],
  stockNumber: ["StockNumber", "Stock Number", "Stock", "Stock #", "StockNo", "Stock No"],
  year: ["Year", "ModelYear", "Model Year"],
  make: ["Make"],
  model: ["Model"],
  trim: ["Trim", "Series", "TrimLevel"],
  bodyStyle: ["BodyStyle", "Body Style", "Body", "BodyType", "Body Type"],
  exteriorColor: ["ExteriorColor", "Exterior Color", "ExtColor", "Ext Color", "Color"],
  interiorColor: ["InteriorColor", "Interior Color", "IntColor", "Int Color"],
  transmission: ["Transmission", "Trans"],
  drivetrain: ["Drivetrain", "DriveTrain", "Drive Type", "DriveType", "Drive"],
  fuelType: ["FuelType", "Fuel Type", "Fuel"],
  mileage: ["Mileage", "Miles", "Odometer"],
  price: ["Price", "InternetPrice", "Internet Price", "SellingPrice", "Selling Price", "AskingPrice", "Asking Price", "RetailPrice", "Retail Price", "ListPrice"],
  description: ["Description", "Comments", "VehicleDescription", "SellerComments"],
  status: ["Status", "VehicleStatus", "InventoryStatus"],
  photos: ["ImageURLs", "Image URLs", "ImageList", "Photos", "PhotoURLs", "Photo URLs", "Images", "ImageURL"],
};

/**
 * Columns that can carry customer PII or confidential dealer economics. They
 * are dropped before any value is read, can never be mapped, and only their
 * header names (never their values) are reported back.
 */
const blockedHeader = /(customer|buyer|cobuyer|purchaser|owner|firstname|lastname|fullname|email|phone|mobile|cell|address|street|city|zip|postal|ssn|social|birth|dob|license|licence|lien|lender|creditor|bank|cost|acv|purchaseprice|floor|profit|gross|deal|salesperson|internalnote|notes$|tradein|payoff|ssn)/;
export const isBlockedHeader = (header: string) => blockedHeader.test(normalizeHeader(header));

export function resolveColumns(headers: string[], mapping: ColumnMapping = defaultDealerCenterMapping) {
  const normalized = headers.map(normalizeHeader);
  const blocked = headers.filter(isBlockedHeader);
  const columns: Partial<Record<ImportField, number>> = {};
  for (const field of importFields) {
    for (const alias of mapping[field] ?? defaultDealerCenterMapping[field]) {
      const index = normalized.indexOf(normalizeHeader(alias));
      if (index !== -1 && !isBlockedHeader(headers[index]!)) { columns[field] = index; break; }
    }
  }
  const used = new Set(Object.values(columns));
  const ignored = headers.filter((header, index) => !used.has(index) && !isBlockedHeader(header) && header.trim());
  return { columns, blocked, ignored };
}

/** Validate an admin-supplied mapping override: known fields, short string aliases only. */
export function parseMappingOverride(value: unknown): ColumnMapping | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Column mapping must be an object");
  const mapping: ColumnMapping = {};
  for (const [key, aliases] of Object.entries(value)) {
    if (!(importFields as readonly string[]).includes(key)) throw new Error(`Unknown mapping field: ${key.slice(0, 40)}`);
    const list = typeof aliases === "string" ? [aliases] : aliases;
    if (!Array.isArray(list) || list.length > 10 || !list.every(alias => typeof alias === "string" && alias.length > 0 && alias.length <= 60)) throw new Error(`Invalid mapping for ${key}`);
    if (list.some(alias => isBlockedHeader(alias))) throw new Error(`Mapping for ${key} targets a blocked customer or cost column`);
    mapping[key as ImportField] = list;
  }
  return { ...defaultDealerCenterMapping, ...mapping };
}

const synonyms: { [K in "bodyStyle" | "transmission" | "drivetrain" | "fuelType"]: Array<[RegExp, NonNullable<VehicleDetails[K]>]> } = {
  bodyStyle: [[/convertible|cabrio|roadster/, "Convertible"], [/minivan/, "Minivan"], [/van/, "Van"], [/pickup|truck|crew ?cab|ext(ended)? cab|regular cab/, "Truck"], [/crossover|cuv/, "Crossover"], [/sport utility|suv|4dr sport/, "SUV"], [/wagon/, "Wagon"], [/hatch/, "Hatchback"], [/coupe|2dr/, "Coupe"], [/sedan|4dr|saloon/, "Sedan"]],
  transmission: [[/cvt|continuously/, "CVT"], [/manual|stick|\bmt\b|m\/t/, "Manual"], [/auto|\bat\b|a\/t/, "Automatic"]],
  drivetrain: [[/awd|all.?wheel/, "AWD"], [/4wd|4x4|four.?wheel/, "4WD"], [/fwd|front/, "FWD"], [/rwd|rear/, "RWD"]],
  fuelType: [[/plug|phev/, "Plug-in Hybrid"], [/hybrid|hev/, "Hybrid"], [/electric|\bev\b|battery/, "Electric"], [/diesel/, "Diesel"], [/flex|e85/, "Flex"], [/gas|petrol|unleaded/, "Gasoline"]],
};
const exact: Record<keyof typeof synonyms, readonly string[]> = { bodyStyle: bodyStyles, transmission: transmissions, drivetrain: drivetrains, fuelType: fuelTypes };

/** Map a free-form DMS value to the site's enumerations; null when unrecognized. */
export function normalizeEnum<K extends keyof typeof synonyms>(field: K, raw: string): VehicleDetails[K] | null {
  const value = raw.trim();
  if (!value) return null;
  const direct = exact[field].find(option => option.toLowerCase() === value.toLowerCase());
  if (direct) return direct as VehicleDetails[K];
  const lower = value.toLowerCase();
  for (const [pattern, mapped] of synonyms[field]) if (pattern.test(lower)) return mapped as VehicleDetails[K];
  return null;
}

export function parseNumber(raw: string) {
  const cleaned = raw.replace(/[$,\s]|usd|mi(les)?$/gi, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function normalizeStatus(raw: string): "available" | "pending" | "sold" {
  const value = raw.trim().toLowerCase();
  if (/sold|delivered|wholesaled|inactive|deleted/.test(value)) return "sold";
  if (/pending|deposit|hold|reserved/.test(value)) return "pending";
  return "available";
}

export function splitPhotoUrls(raw: string) {
  return raw.split(/[|,;\s]+/).map(url => url.trim()).filter(url => /^https:\/\/[^\s]+$/i.test(url)).slice(0, 50);
}
