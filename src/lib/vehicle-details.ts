// Optional listing details used by the detail page and future catalog feeds
// (Meta vehicle catalogs need body style, color, etc.). Every field is
// optional so stored v2 catalogs written before these fields remain valid.
export const bodyStyles = ["Sedan", "Coupe", "Hatchback", "Convertible", "Wagon", "SUV", "Crossover", "Truck", "Van", "Minivan", "Other"] as const;
export const transmissions = ["Automatic", "Manual", "CVT", "Other"] as const;
export const drivetrains = ["FWD", "RWD", "AWD", "4WD", "Other"] as const;
export const fuelTypes = ["Gasoline", "Diesel", "Hybrid", "Plug-in Hybrid", "Electric", "Flex", "Other"] as const;
export type VehicleDetails = {
  stockNumber?: string;
  trim?: string;
  bodyStyle?: (typeof bodyStyles)[number];
  exteriorColor?: string;
  interiorColor?: string;
  transmission?: (typeof transmissions)[number];
  drivetrain?: (typeof drivetrains)[number];
  fuelType?: (typeof fuelTypes)[number];
};
export const vehicleDetailKeys = ["stockNumber", "trim", "bodyStyle", "exteriorColor", "interiorColor", "transmission", "drivetrain", "fuelType"] as const satisfies readonly (keyof VehicleDetails)[];
const enumDetails: Partial<Record<keyof VehicleDetails, readonly string[]>> = { bodyStyle: bodyStyles, transmission: transmissions, drivetrain: drivetrains, fuelType: fuelTypes };
const freeTextDetail = /^[A-Za-z0-9 .,'&/()+-]{1,40}$/;
const stockNumberPattern = /^[A-Za-z0-9-]{1,20}$/;

export function validDetail(key: keyof VehicleDetails, value: unknown) {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const allowed = enumDetails[key];
  if (allowed) return allowed.includes(value);
  return key === "stockNumber" ? stockNumberPattern.test(value) : freeTextDetail.test(value);
}

/** Validate and normalize optional details; empty strings clear a field. */
export function sanitizeVehicleDetails(input: Record<string, unknown>): VehicleDetails {
  const details: VehicleDetails = {};
  for (const key of vehicleDetailKeys) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim().replace(/\s+/g, " ");
    if (!value) continue;
    const normalized = key === "stockNumber" ? value.toUpperCase() : value;
    if (!validDetail(key, normalized)) throw new Error(`Enter a valid ${detailLabels[key].toLowerCase()}`);
    (details as Record<string, string>)[key] = normalized;
  }
  return details;
}
export const detailLabels: Record<keyof VehicleDetails, string> = {
  stockNumber: "Stock number", trim: "Trim", bodyStyle: "Body style", exteriorColor: "Exterior color",
  interiorColor: "Interior color", transmission: "Transmission", drivetrain: "Drivetrain", fuelType: "Fuel type",
};

/** Stable public path for a listing. The id is a server-generated UUID that never changes. */
export function vehiclePath(vehicle: { id: string }) {
  return `/inventory/${encodeURIComponent(vehicle.id)}`;
}
export const vehicleIdPattern = /^[A-Za-z0-9-]{1,64}$/;
