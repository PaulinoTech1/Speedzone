import { recordDiagnostic, withDiagnostics } from "@/lib/diagnostics";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isAdminAuthenticated, privateResponseHeaders } from "@/lib/admin-auth";
import {
  getInventoryBlobOrigin,
  inventoryPhotoContentTypes,
  isInventoryPhotoPath,
  maxInventoryPhotoSize,
} from "@/lib/inventory-photos";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { validAdminMutation } from "@/lib/admin-mutation";
import { getRedis } from "@/lib/redis";
import { inventoryPhotoStateKey } from "@/lib/inventory-state";
import { readBoundedJson, RequestBodyError } from "@/lib/shared/mutation-request";

function uploadConfigurationError() {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return "Inventory photo storage is missing BLOB_READ_WRITE_TOKEN";
  }
  if (!getInventoryBlobOrigin()) {
    return "Inventory photo storage has an invalid BLOB_STORE_ID or INVENTORY_BLOB_ORIGIN";
  }
  return null;
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: privateResponseHeaders() },
    );
  }

  const error = uploadConfigurationError();
  if (error) await recordDiagnostic("INVENTORY_PHOTO_UPLOAD_AUTHORIZE", 503);
  return NextResponse.json(
    error ? { ready: false, error } : { ready: true },
    { status: error ? 503 : 200, headers: privateResponseHeaders() },
  );
}

async function diagnosedPOST(request: Request) {
  if (!(await isAdminAuthenticated(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let parsedBody: unknown;

  try {
    parsedBody = await readBoundedJson(request);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid upload request" },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: privateResponseHeaders() },
    );
  }

  if (
    !parsedBody ||
    typeof parsedBody !== "object" ||
    !("type" in parsedBody) ||
    parsedBody.type !== "blob.generate-client-token" ||
    !("payload" in parsedBody) ||
    !parsedBody.payload ||
    typeof parsedBody.payload !== "object" ||
    !("pathname" in parsedBody.payload) ||
    typeof parsedBody.payload.pathname !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid upload request" },
      { status: 400, headers: privateResponseHeaders() },
    );
  }

  const body = parsedBody as Extract<
    HandleUploadBody,
    { type: "blob.generate-client-token" }
  >;

  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: privateResponseHeaders() },
    );
  }

  if (!isInventoryPhotoPath(body.payload.pathname)) {
    return NextResponse.json(
      { error: `Invalid photo path: ${body.payload.pathname.slice(0, 120)}` },
      { status: 400, headers: privateResponseHeaders() },
    );
  }

  const configurationError = uploadConfigurationError();
  if (configurationError) {
    return NextResponse.json(
      { error: configurationError },
      { status: 503, headers: privateResponseHeaders() },
    );
  }

  try {
    const redis = getRedis();
    if (!redis) throw new Error("Upload coordination is unavailable");
    const url = `${getInventoryBlobOrigin()}/${body.payload.pathname}`;
    const key = inventoryPhotoStateKey(url);
    if (!await redis.set(key, "uploading", { nx: true, ex: 86400 })) throw new Error("Photo path is already reserved");
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: inventoryPhotoContentTypes,
        maximumSizeInBytes: maxInventoryPhotoSize,
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + 60 * 60 * 1000,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
      }),
    });

    await writeSecurityEvent({ ...securityRequestContext(request,true), event: "inventory.upload", outcome: "allowed", actor: "admin", reason: "upload_token_issued" });
    return NextResponse.json(response, { headers: privateResponseHeaders() });
  } catch (error) {
    console.error("[inventory] unable to issue photo upload token", error);
    return NextResponse.json(
      { error: "Unable to start photo upload" },
      { status: 500, headers: privateResponseHeaders() },
    );
  }
}

export async function POST(request: Request) { return withDiagnostics("INVENTORY_PHOTO_UPLOAD_AUTHORIZE", () => diagnosedPOST(request)); }
