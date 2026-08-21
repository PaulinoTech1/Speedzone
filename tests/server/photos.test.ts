import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { inspectWebP, verifyAndNormalizeWebP } from "@/lib/server/photos";

describe("server-side WebP inspection", () => {
  it("rejects spoofed and truncated input", () => {
    expect(inspectWebP(Buffer.from("not a webp"))).toBeNull();
    const spoof = Buffer.alloc(40);
    spoof.write("RIFF", 0, "ascii");
    spoof.write("WEBP", 8, "ascii");
    spoof.write("NOPE", 12, "ascii");
    expect(inspectWebP(spoof)).toBeNull();
  });

  it("reads bounded dimensions from a VP8X header", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp.writeUIntLE(1599, 24, 3);
    webp.writeUIntLE(899, 27, 3);
    expect(inspectWebP(webp)).toEqual({ width: 1600, height: 900 });
  });

  it("fully decodes and re-encodes WebP instead of trusting a header", async () => {
    const headerOnly = Buffer.alloc(30);
    headerOnly.write("RIFF", 0, "ascii");
    headerOnly.write("WEBP", 8, "ascii");
    headerOnly.write("VP8X", 12, "ascii");
    headerOnly.writeUIntLE(1, 16, 4);
    headerOnly.writeUIntLE(1, 24, 3);
    headerOnly.writeUIntLE(1, 27, 3);
    await expect(verifyAndNormalizeWebP(headerOnly, 1600, 4 * 1024 * 1024)).rejects.toThrow();

    const valid = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: { r: 180, g: 30, b: 35 },
      },
    }).webp().toBuffer();
    const normalized = await verifyAndNormalizeWebP(valid, 1600, 4 * 1024 * 1024);
    expect(normalized).toMatchObject({ width: 4, height: 3 });
    expect((await sharp(normalized.buffer).metadata()).format).toBe("webp");
  });

  it("rejects actual byte and decoded dimension limits", async () => {
    const validButOverLimit = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    }).webp().toBuffer();
    expect((await sharp(validButOverLimit).metadata()).format).toBe("webp");
    await expect(
      verifyAndNormalizeWebP(validButOverLimit, 1600, validButOverLimit.byteLength - 1),
    ).rejects.toThrow(/valid WebP/i);

    const oversizedDimensions = await sharp({
      create: {
        width: 1601,
        height: 2,
        channels: 3,
        background: { r: 20, g: 30, b: 40 },
      },
    }).webp().toBuffer();
    await expect(
      verifyAndNormalizeWebP(oversizedDimensions, 1600, 4 * 1024 * 1024),
    ).rejects.toThrow(/correctly sized/i);
  });
});
