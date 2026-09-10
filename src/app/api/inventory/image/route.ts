import { NextRequest, NextResponse } from "next/server";
import { getInventoryBlobOrigin, isInventoryPhotoPath } from "@/lib/inventory-photos";

const maxImageBytes = 8 * 1024 * 1024;
const timeoutMs = 30_000;
const imageHeaders = {
  "Cache-Control": "public, max-age=300, s-maxage=3600",
  "Content-Disposition": 'inline; filename="inventory-photo.webp"',
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

function detectImage(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function readBoundedBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxImageBytes) return { tooLarge: true as const };
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes: result, tooLarge: false as const };
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: NextRequest) {
  const origin = getInventoryBlobOrigin();
  if (!origin) return new NextResponse("Image service unavailable", { status: 500 });

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new NextResponse("Missing image URL", { status: 400 });

  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return new NextResponse("Invalid image URL", { status: 400 });
  }
  if (imageUrl.origin !== origin || !isInventoryPhotoPath(imageUrl.pathname.slice(1)) || imageUrl.search || imageUrl.hash) {
    return new NextResponse("Image host not allowed", { status: 403 });
  }

  try {
    const response = await fetch(imageUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok || !response.body || response.status >= 300) return new NextResponse("Image unavailable", { status: 404 });
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxImageBytes) return new NextResponse("Image unavailable", { status: 413 });

    const result = await readBoundedBody(response.body);
    if (result.tooLarge) return new NextResponse("Image unavailable", { status: 413 });
    const contentType = detectImage(result.bytes);
    if (!contentType) return new NextResponse("Image unavailable", { status: 415 });
    return new NextResponse(result.bytes, { headers: { ...imageHeaders, "Content-Type": contentType } });
  } catch {
    return new NextResponse("Image unavailable", { status: 404 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;
