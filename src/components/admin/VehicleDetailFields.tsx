import { bodyStyles, detailLabels, drivetrains, fuelTypes, transmissions, vehicleDetailKeys, type VehicleDetails } from "@/lib/vehicle-details";

const options: Partial<Record<keyof VehicleDetails, readonly string[]>> = { bodyStyle: bodyStyles, transmission: transmissions, drivetrain: drivetrains, fuelType: fuelTypes };

export const emptyVehicleDetails = Object.fromEntries(vehicleDetailKeys.map(key => [key, ""])) as Record<keyof VehicleDetails, string>;
export function vehicleDetailValues(vehicle: VehicleDetails) {
  return Object.fromEntries(vehicleDetailKeys.map(key => [key, vehicle[key] || ""])) as Record<keyof VehicleDetails, string>;
}

/** Optional listing details shared by the create and edit forms. */
export default function VehicleDetailFields({ values, onChange, idPrefix }: { values: Partial<Record<string, string>>; onChange: (key: keyof VehicleDetails, value: string) => void; idPrefix: string }) {
  return (
    <fieldset className="admin-vehicle-details">
      <legend>Listing details (optional)</legend>
      <div className="admin-form-grid">
        {vehicleDetailKeys.map(key => {
          const choices = options[key];
          const id = `${idPrefix}-${key}`;
          return choices
            ? <label key={key} htmlFor={id}>{detailLabels[key]}<select id={id} name={key} value={values[key] || ""} onChange={e => onChange(key, e.target.value)}><option value="">Not specified</option>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label>
            : <label key={key} htmlFor={id}>{detailLabels[key]}<input id={id} name={key} value={values[key] || ""} onChange={e => onChange(key, key === "stockNumber" ? e.target.value.toUpperCase() : e.target.value)} maxLength={key === "stockNumber" ? 20 : 40} pattern={key === "stockNumber" ? "[A-Za-z0-9-]{1,20}" : undefined} autoComplete="off" /></label>;
        })}
      </div>
    </fieldset>
  );
}
