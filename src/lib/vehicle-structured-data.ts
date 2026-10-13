import type { Vehicle } from "@/lib/inventory";
import { vehiclePath } from "@/lib/vehicle-details";

const origin = "https://www.speedzonems.com";
const fuel: Record<string, string> = { Gasoline: "Gasoline", Diesel: "Diesel", Hybrid: "Hybrid", "Plug-in Hybrid": "Plug-in hybrid", Electric: "Electric", Flex: "Flex fuel" };
const drive: Record<string, string> = { FWD: "https://schema.org/FrontWheelDriveConfiguration", RWD: "https://schema.org/RearWheelDriveConfiguration", AWD: "https://schema.org/AllWheelDriveConfiguration", "4WD": "https://schema.org/FourWheelDriveConfiguration" };

export const vehicleTitle = (vehicle: Vehicle) => [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");

/** Public photo URLs only: absolute HTTPS, nothing else. */
export const publicPhotos = (vehicle: Vehicle) => vehicle.photos.filter(url => /^https:\/\//i.test(url)).slice(0, 10);

/**
 * schema.org Car for one listing. Only public listing data; no internal
 * notes, cost, or customer data exist on the Vehicle model.
 */
export function vehicleStructuredData(vehicle: Vehicle) {
  const url = `${origin}${vehiclePath(vehicle)}`;
  const images = publicPhotos(vehicle);
  return {
    "@context": "https://schema.org",
    "@type": "Car",
    "@id": `${url}#vehicle`,
    name: vehicleTitle(vehicle),
    url,
    brand: { "@type": "Brand", name: vehicle.make },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    ...(vehicle.vin ? { vehicleIdentificationNumber: vehicle.vin } : {}),
    ...(vehicle.stockNumber ? { sku: vehicle.stockNumber } : {}),
    ...(vehicle.trim ? { vehicleConfiguration: vehicle.trim } : {}),
    ...(vehicle.bodyStyle ? { bodyType: vehicle.bodyStyle } : {}),
    ...(vehicle.exteriorColor ? { color: vehicle.exteriorColor } : {}),
    ...(vehicle.interiorColor ? { vehicleInteriorColor: vehicle.interiorColor } : {}),
    ...(vehicle.transmission ? { vehicleTransmission: vehicle.transmission } : {}),
    ...(vehicle.drivetrain && drive[vehicle.drivetrain] ? { driveWheelConfiguration: drive[vehicle.drivetrain] } : {}),
    ...(vehicle.fuelType && fuel[vehicle.fuelType] ? { fuelType: fuel[vehicle.fuelType] } : {}),
    mileageFromOdometer: { "@type": "QuantitativeValue", value: vehicle.mileage, unitCode: "SMI" },
    itemCondition: "https://schema.org/UsedCondition",
    ...(images.length ? { image: images } : {}),
    ...(vehicle.description ? { description: vehicle.description.slice(0, 500) } : {}),
    offers: {
      "@type": "Offer",
      url,
      price: vehicle.price,
      priceCurrency: "USD",
      itemCondition: "https://schema.org/UsedCondition",
      availability: vehicle.status === "sold" ? "https://schema.org/SoldOut" : vehicle.status === "pending" ? "https://schema.org/LimitedAvailability" : "https://schema.org/InStock",
      seller: { "@id": `${origin}/#dealership` },
    },
  };
}

/** JSON for an inline script: escape characters that could end the script element. */
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
