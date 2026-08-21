import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import type { VehicleInput, VehiclePhoto, VehicleRecord, VehicleStatus } from "@/lib/domain/vehicle";

export type SessionSummary = {
  administrator: string;
  absoluteExpiresAt: number;
  passkeyCount: number;
  needsBackupPasskey: boolean;
  stepUpValid: boolean;
};

export type InventoryResponse = {
  ok: true;
  revision: number;
  vehicles: VehicleRecord[];
};

export type VehicleResponse = {
  ok: true;
  vehicle: VehicleRecord;
};

export type PasskeySummary = {
  id: string;
  label: string;
  createdAt: string;
  transports: string[];
};

export type PasskeysResponse = {
  ok: true;
  passkeys: PasskeySummary[];
  needsBackupPasskey: boolean;
};

export type AuthenticationOptionsResponse = {
  ok: true;
  options: PublicKeyCredentialRequestOptionsJSON;
};

export type RegistrationOptionsResponse = {
  ok: true;
  options: PublicKeyCredentialCreationOptionsJSON;
};

export type VehicleFormValues = {
  stockNumber: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  price: string;
  mileage: string;
  exteriorColor: string;
  interiorColor: string;
  bodyStyle: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  engine: string;
  description: string;
  featuresText: string;
  status: VehicleStatus;
  slug: string;
  photographs: VehiclePhoto[];
};

export function blankVehicleForm(): VehicleFormValues {
  return {
    stockNumber: "",
    vin: "",
    year: String(new Date().getFullYear()),
    make: "",
    model: "",
    trim: "",
    price: "",
    mileage: "",
    exteriorColor: "",
    interiorColor: "",
    bodyStyle: "",
    transmission: "",
    drivetrain: "",
    fuelType: "",
    engine: "",
    description: "",
    featuresText: "",
    status: "draft",
    slug: "",
    photographs: [],
  };
}

export function vehicleToForm(vehicle: VehicleRecord): VehicleFormValues {
  return {
    stockNumber: vehicle.stockNumber,
    vin: vehicle.vin,
    year: String(vehicle.year),
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    price: String(vehicle.price),
    mileage: String(vehicle.mileage),
    exteriorColor: vehicle.exteriorColor,
    interiorColor: vehicle.interiorColor,
    bodyStyle: vehicle.bodyStyle,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    fuelType: vehicle.fuelType,
    engine: vehicle.engine,
    description: vehicle.description,
    featuresText: vehicle.features.join("\n"),
    status: vehicle.status,
    slug: vehicle.slug,
    photographs: vehicle.photographs,
  };
}

export function formToVehicleInput(
  form: VehicleFormValues,
  expectedVersion?: number,
): VehicleInput {
  return {
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    stockNumber: form.stockNumber,
    vin: form.vin,
    year: Number(form.year),
    make: form.make,
    model: form.model,
    trim: form.trim,
    price: Number(form.price),
    mileage: Number(form.mileage),
    exteriorColor: form.exteriorColor,
    interiorColor: form.interiorColor,
    bodyStyle: form.bodyStyle,
    transmission: form.transmission,
    drivetrain: form.drivetrain,
    fuelType: form.fuelType,
    engine: form.engine,
    description: form.description,
    features: form.featuresText
      .split("\n")
      .map((feature) => feature.trim())
      .filter(Boolean),
    status: form.status,
    slug: form.slug,
    photographs: form.photographs,
  };
}

