import { NextRequest } from "next/server";

import { vinPattern } from "@/lib/domain/trade-in";
import { noStoreJson, RequestValidationError } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { decodeVin, recallsForVehicle } from "@/lib/server/vehicle-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    enforceClientRateLimit(request, "recallCheck");

    const rawVin = request.nextUrl.searchParams.get("vin")?.trim().toUpperCase() ?? "";
    if (!vinPattern.test(rawVin)) {
      throw new RequestValidationError("Enter a valid 17-character VIN", 422, "INVALID_VIN");
    }

    const { vehicle, warning } = await decodeVin(rawVin);
    if (!vehicle.year || !vehicle.make || !vehicle.model) {
      throw new RequestValidationError(
        "That VIN decoded, but not with enough detail to look up recalls.",
        422,
        "VIN_NOT_DECODED",
      );
    }

    const campaigns = await recallsForVehicle(vehicle.year, vehicle.make, vehicle.model);

    return noStoreJson({
      ok: true,
      vehicle: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
      },
      campaigns,
      warning,
    });
  } catch (error) {
    return routeError(error);
  }
}
