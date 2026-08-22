import { NextRequest } from "next/server";

import { vinPattern, type DecodedVehicle } from "@/lib/domain/trade-in";
import { noStoreJson, RequestValidationError } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NhtsaResult = Record<string, unknown>;

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function engineSummary(result: NhtsaResult): string | null {
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

// The browser never calls NHTSA directly: proxying server-side means the
// site's Content-Security-Policy connect-src doesn't need a third-party host,
// and lets us validate the VIN and normalize NHTSA's ~150-field response.
export async function GET(request: NextRequest) {
  try {
    enforceClientRateLimit(request, "vinDecode");

    const rawVin = request.nextUrl.searchParams.get("vin")?.trim().toUpperCase() ?? "";
    if (!vinPattern.test(rawVin)) {
      throw new RequestValidationError("Enter a valid 17-character VIN", 422, "INVALID_VIN");
    }

    let response: Response;
    try {
      response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(rawVin)}?format=json`,
        { signal: AbortSignal.timeout(8000) },
      );
    } catch {
      throw new RequestValidationError("Vehicle lookup is temporarily unavailable", 502, "VIN_LOOKUP_FAILED");
    }
    if (!response.ok) {
      throw new RequestValidationError("Vehicle lookup is temporarily unavailable", 502, "VIN_LOOKUP_FAILED");
    }

    const payload = (await response.json()) as { Results?: NhtsaResult[] };
    const result = payload.Results?.[0];
    if (!result) {
      throw new RequestValidationError("Vehicle lookup is temporarily unavailable", 502, "VIN_LOOKUP_FAILED");
    }

    const errorCode = nonEmpty(result.ErrorCode);
    const codes = errorCode ? errorCode.split(",").map((code) => code.trim()) : [];
    const hasIssue = codes.some((code) => code !== "0");

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
        "That VIN couldn't be decoded. Double-check it or fill in the details manually.",
        422,
        "VIN_NOT_DECODED",
      );
    }

    return noStoreJson({
      ok: true,
      vehicle,
      warning: hasIssue
        ? "Some details may be incomplete for this VIN — please double-check them."
        : null,
    });
  } catch (error) {
    return routeError(error);
  }
}
