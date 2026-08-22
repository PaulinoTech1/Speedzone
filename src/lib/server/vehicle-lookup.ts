import "server-only";

import type { DecodedVehicle } from "@/lib/domain/trade-in";
import type { RecallCampaign } from "@/lib/domain/recall";
import { RequestValidationError } from "@/lib/server/request";

const lookupTimeoutMs = 8000;

type NhtsaRecord = Record<string, unknown>;

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function engineSummary(result: NhtsaRecord): string | null {
  const displacement = nonEmpty(result.DisplacementL);
  const cylinders = nonEmpty(result.EngineCylinders);
  const parts: string[] = [];
  if (displacement) {
    const liters = Number(displacement);
    parts.push(Number.isFinite(liters) ? `${liters.toFixed(1)}L` : displacement);
  }
  if (cylinders) parts.push(`${cylinders}-cyl`);
  return parts.length ? parts.join(" ") : null;
}

async function fetchNhtsa(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(lookupTimeoutMs) });
  } catch {
    throw new RequestValidationError(
      "Vehicle lookup is temporarily unavailable",
      502,
      "VIN_LOOKUP_FAILED",
    );
  }
  if (!response.ok) {
    throw new RequestValidationError(
      "Vehicle lookup is temporarily unavailable",
      502,
      "VIN_LOOKUP_FAILED",
    );
  }
  return response.json();
}

export type VinDecodeResult = { vehicle: DecodedVehicle; warning: string | null };

/** Decode a 17-character VIN through NHTSA's free vPIC service. */
export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const payload = (await fetchNhtsa(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
  )) as { Results?: NhtsaRecord[] };

  const result = payload.Results?.[0];
  if (!result) {
    throw new RequestValidationError(
      "Vehicle lookup is temporarily unavailable",
      502,
      "VIN_LOOKUP_FAILED",
    );
  }

  const errorCode = nonEmpty(result.ErrorCode);
  const hasIssue = (errorCode ? errorCode.split(",") : [])
    .map((code) => code.trim())
    .some((code) => code !== "0");

  const yearText = nonEmpty(result.ModelYear);
  const vehicle: DecodedVehicle = {
    year: yearText && Number.isFinite(Number(yearText)) ? Number(yearText) : null,
    make: nonEmpty(result.Make),
    model: nonEmpty(result.Model),
    trim: nonEmpty(result.Trim),
    bodyStyle: nonEmpty(result.BodyClass),
    engine: engineSummary(result),
    transmission: nonEmpty(result.TransmissionStyle),
    drivetrain: nonEmpty(result.DriveType),
    fuelType: nonEmpty(result.FuelTypePrimary),
  };

  if (!vehicle.make && !vehicle.model) {
    throw new RequestValidationError(
      "That VIN couldn't be decoded. Double-check it or enter the details manually.",
      422,
      "VIN_NOT_DECODED",
    );
  }

  return {
    vehicle,
    warning: hasIssue
      ? "Some details may be incomplete for this VIN — please double-check them."
      : null,
  };
}

/**
 * NHTSA's public recall API is keyed by year/make/model, not by VIN: a VIN
 * query silently returns zero results. Campaigns therefore describe the model,
 * and cannot say whether one specific car has already had the work done.
 */
export async function recallsForVehicle(
  year: number,
  make: string,
  model: string,
): Promise<RecallCampaign[]> {
  const url = new URL("https://api.nhtsa.gov/recalls/recallsByVehicle");
  url.searchParams.set("make", make);
  url.searchParams.set("model", model);
  url.searchParams.set("modelYear", String(year));

  const payload = (await fetchNhtsa(url.toString())) as { results?: NhtsaRecord[] };
  const records = Array.isArray(payload.results) ? payload.results : [];

  return records.slice(0, 25).map((record) => ({
    campaignNumber: nonEmpty(record.NHTSACampaignNumber) ?? "Unknown",
    component: nonEmpty(record.Component) ?? "Unspecified component",
    summary: nonEmpty(record.Summary) ?? "",
    consequence: nonEmpty(record.Consequence) ?? "",
    remedy: nonEmpty(record.Remedy) ?? "",
    reportReceivedDate: nonEmpty(record.ReportReceivedDate),
    parkIt: record.parkIt === true,
    parkOutSide: record.parkOutSide === true,
  }));
}
