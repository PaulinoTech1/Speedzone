import { NextRequest } from "next/server";

import { vinPattern } from "@/lib/domain/trade-in";
import { noStoreJson, RequestValidationError } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { decodeVin } from "@/lib/server/vehicle-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser never calls NHTSA directly: proxying server-side means the
// site's Content-Security-Policy connect-src doesn't need a third-party host,
// and lets us validate the VIN and normalize NHTSA's ~150-field response.
export async function GET(request: NextRequest) {
  try {
    await enforceClientRateLimit(request, "vinDecode");

    const rawVin = request.nextUrl.searchParams.get("vin")?.trim().toUpperCase() ?? "";
    if (!vinPattern.test(rawVin)) {
      throw new RequestValidationError("Enter a valid 17-character VIN", 422, "INVALID_VIN");
    }

    const { vehicle, warning } = await decodeVin(rawVin);
    return noStoreJson({ ok: true, vehicle, warning });
  } catch (error) {
    return routeError(error);
  }
}
