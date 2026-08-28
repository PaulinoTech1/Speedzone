import "server-only";

import { randomUUID } from "node:crypto";

import sharp from "sharp";

import type { VehiclePhoto } from "@/lib/domain/vehicle";
import { sanity, translateSanityError } from "@/lib/server/storage/sanity";

export type ImageDimensions = { width: number; height: number };
type VerifiedWebP = ImageDimensions & { buffer: Buffer };

function textAt(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString("ascii");
}

export function inspectWebP(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30 || textAt(buffer, 0, 4) !== "RIFF" || textAt(buffer, 8, 4) !== "WEBP") {
    return null;
  }
  const format = textAt(buffer, 12, 4);
  if (format === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  if (
    format === "VP8 " &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (format === "VP8L" && buffer[20] === 0x2f) {
    const b0 = buffer[21] ?? 0;
    const b1 = buffer[22] ?? 0;
    const b2 = buffer[23] ?? 0;
    const b3 = buffer[24] ?? 0;
    return {
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    };
  }
  return null;
}

export async function verifyAndNormalizeWebP(
  buffer: Buffer,
  maximumDimension: number,
  maximumBytes: number,
): Promise<VerifiedWebP> {
  if (buffer.byteLength > maximumBytes || !inspectWebP(buffer)) {
    throw new Error("Photograph is not a valid WebP image");
  }

  const inputOptions = {
    failOn: "error" as const,
    limitInputPixels: maximumDimension * maximumDimension,
    sequentialRead: true,
  };
  const metadata = await sharp(buffer, inputOptions).metadata();
  if (
    metadata.format !== "webp" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > maximumDimension ||
    metadata.height > maximumDimension
  ) {
    throw new Error("Photograph is not a valid, correctly sized WebP image");
  }

  // A complete server-side decode and fresh encoding rejects truncated or
  // polyglot payloads and strips any metadata a bypassed client left behind.
  const normalized = await sharp(buffer, inputOptions)
    .rotate()
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (
    normalized.info.format !== "webp" ||
    normalized.info.width > maximumDimension ||
    normalized.info.height > maximumDimension ||
    normalized.data.byteLength > maximumBytes
  ) {
    throw new Error("Photograph is not a valid, correctly sized WebP image");
  }
  return {
    buffer: normalized.data,
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

/**
 * Uploads an already-verified WebP buffer to Sanity's asset store and returns
 * a `VehiclePhoto`. The caller must have already run the buffer through
 * `verifyAndNormalizeWebP` — this function trusts `width`/`height`/the
 * buffer's own length rather than re-deriving them from Sanity's response,
 * the same defensive posture the previous Blob-backed pipeline used.
 */
export async function uploadVehiclePhoto(input: {
  buffer: Buffer;
  width: number;
  height: number;
  alt: string;
}): Promise<VehiclePhoto> {
  let asset;
  try {
    asset = await sanity().assets.upload("image", input.buffer, {
      filename: `${randomUUID()}.webp`,
      contentType: "image/webp",
    });
  } catch (error) {
    throw translateSanityError(error);
  }
  return {
    url: asset.url,
    // Repurposed to hold the Sanity asset document ID, not a Blob path.
    pathname: asset._id,
    width: input.width,
    height: input.height,
    bytes: input.buffer.byteLength,
    alt: input.alt.trim().slice(0, 180),
    createdAt: new Date().toISOString(),
  };
}
