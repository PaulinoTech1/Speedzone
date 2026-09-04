import { get } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";

import { leadBlobStoreId, leadBlobToken } from "@/lib/server/env";
import { noStoreJson, RequestValidationError } from "@/lib/server/request";
import { requireAdmin, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testDrivePathPattern = /^leads\/test-drive\/[^/]+\.json$/;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin(request);

    const pathname = request.nextUrl.searchParams.get("pathname")?.trim() ?? "";
    if (!testDrivePathPattern.test(pathname)) {
      throw new RequestValidationError("Blob path is invalid", 400, "INVALID_BLOB_PATH");
    }

    const result = await get(pathname, {
      access: "private",
      storeId: leadBlobStoreId(),
      token: leadBlobToken(),
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const response = new NextResponse(result.stream, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": result.blob.contentType || "application/json",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return response;
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return noStoreJson(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return routeError(error);
  }
}