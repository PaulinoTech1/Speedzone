import { createHmac, timingSafeEqual } from "node:crypto";
import type { Vehicle } from "@/lib/inventory";
import { vehiclePath } from "@/lib/vehicle-details";

/**
 * Meta Automotive Inventory Ads vehicle catalog feed (CSV).
 *
 * Field names and enum values are taken from Meta's official Business SDK
 * Vehicle object (facebook-python-business-sdk, adobjects/vehicle.py).
 * The flattened CSV header style for nested fields (mileage.value,
 * address.addr1, image[0].url) could not be fetched from
 * developers.facebook.com (403 to automated clients) and comes from
 * secondary sources: VERIFY in Commerce Manager's feed upload diagnostics
 * before going live.
 */
export const maxFeedImages = 20;
const origin = "https://www.speedzonems.com";

// Public dealership details, identical to the home page AutoDealer data.
export const dealer = {
  name: "SpeedZone Motorsports",
  phone: "+15088269405",
  addr1: "1094 Main St",
  city: "Worcester",
  region: "MA",
  postalCode: "01603",
  country: "US",
} as const;

const bodyStyle: Record<string, string> = { Sedan: "SEDAN", Coupe: "COUPE", Hatchback: "HATCHBACK", Convertible: "CONVERTIBLE", Wagon: "WAGON", SUV: "SUV", Crossover: "CROSSOVER", Truck: "TRUCK", Van: "VAN", Minivan: "MINIVAN", Other: "OTHER" };
// Meta's Transmission enum has no CVT value; a CVT is an automatic.
const transmission: Record<string, string> = { Automatic: "AUTOMATIC", CVT: "AUTOMATIC", Manual: "MANUAL", Other: "OTHER" };
const drivetrain: Record<string, string> = { FWD: "FWD", RWD: "RWD", AWD: "AWD", "4WD": "FOUR_WD", Other: "OTHER" };
const fuelType: Record<string, string> = { Gasoline: "GASOLINE", Diesel: "DIESEL", Hybrid: "HYBRID", "Plug-in Hybrid": "PLUGIN_HYBRID", Electric: "ELECTRIC", Flex: "FLEX", Other: "OTHER" };

const imageColumns = Array.from({ length: maxFeedImages }, (_, i) => `image[${i}].url`);
export const feedColumns = [
  "vehicle_id", "title", "description", "url", "make", "model", "year", "trim", "vin",
  "mileage.value", "mileage.unit", "body_style", "exterior_color", "interior_color", "transmission", "drivetrain", "fuel_type",
  "state_of_vehicle", "vehicle_type", "price", "availability",
  "dealer_name", "dealer_phone", "address.addr1", "address.city", "address.region", "address.postal_code", "address.country",
  ...imageColumns,
] as const;

/** Stable, non-PII identifier: VIN when present, else the listing UUID. */
export const feedVehicleId = (vehicle: Vehicle) => vehicle.vin || vehicle.id;

/**
 * Listings eligible for the catalog: not sold and with at least one HTTPS
 * photo (Meta requires an image). Everything emitted is already public on
 * the vehicle page; the Vehicle model holds no customer or cost data.
 */
export function feedRows(vehicles: Vehicle[]) {
  return vehicles
    .filter(vehicle => vehicle.status !== "sold")
    .map(vehicle => ({ vehicle, images: vehicle.photos.filter(url => /^https:\/\//i.test(url)).slice(0, maxFeedImages) }))
    .filter(({ images }) => images.length > 0)
    .map(({ vehicle, images }) => {
      const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
      const row: Record<(typeof feedColumns)[number], string> = Object.fromEntries(feedColumns.map(column => [column, ""])) as never;
      Object.assign(row, {
        vehicle_id: feedVehicleId(vehicle), title, description: (vehicle.description || title).slice(0, 5000), url: `${origin}${vehiclePath(vehicle)}`,
        make: vehicle.make, model: vehicle.model, year: String(vehicle.year), trim: vehicle.trim ?? "", vin: vehicle.vin ?? "",
        "mileage.value": String(Math.round(vehicle.mileage)), "mileage.unit": "MI",
        body_style: bodyStyle[vehicle.bodyStyle ?? ""] ?? "OTHER", exterior_color: vehicle.exteriorColor ?? "", interior_color: vehicle.interiorColor ?? "",
        transmission: transmission[vehicle.transmission ?? ""] ?? "", drivetrain: drivetrain[vehicle.drivetrain ?? ""] ?? "", fuel_type: fuelType[vehicle.fuelType ?? ""] ?? "",
        state_of_vehicle: "USED", vehicle_type: "CAR_TRUCK", price: `${vehicle.price.toFixed(2)} USD`,
        availability: vehicle.status === "pending" ? "PENDING" : "AVAILABLE",
        dealer_name: dealer.name, dealer_phone: dealer.phone, "address.addr1": dealer.addr1, "address.city": dealer.city,
        "address.region": dealer.region, "address.postal_code": dealer.postalCode, "address.country": dealer.country,
      });
      images.forEach((url, i) => { row[`image[${i}].url`] = url; });
      return row;
    });
}

function csvCell(value: string) {
  // Neutralize spreadsheet formula prefixes for anyone opening the file, and quote every cell.
  const safe = /^[=@\t\r]/.test(value) ? ` ${value}` : value;
  return `"${safe.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
}

export function buildVehicleFeedCsv(vehicles: Vehicle[]) {
  const lines = [feedColumns.map(csvCell).join(","), ...feedRows(vehicles).map(row => feedColumns.map(column => csvCell(row[column] ?? "")).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

/** Feed token: at least 32 characters. Unset or short means the feed is disabled. */
export function configuredFeedToken() {
  const token = process.env.META_FEED_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

/** Constant-time token check over fixed-length HMAC digests (no length leak). */
export function feedTokenMatches(supplied: string | null | undefined, expected: string) {
  if (!supplied) return false;
  const key = "speedzone-meta-feed";
  const a = createHmac("sha256", key).update(supplied).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Accepts HTTP Basic auth (any username, token as password) or a Bearer
 * header. A `?token=` query parameter is deliberately NOT accepted: query
 * strings are written to platform request logs and can leak via referrers.
 */
export function suppliedFeedToken(request: Request) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator !== -1) return decoded.slice(separator + 1);
    } catch { /* fall through */ }
  }
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}
