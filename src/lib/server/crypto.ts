import "server-only";

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function base64url(input: Uint8Array | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function fromBase64url(input: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(input, "base64url"));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generate a monotonic but unpredictable epoch change without risking overflow. */
export function nextSessionEpoch(current: number): number {
  const increment = randomInt(1, 1_048_577);
  if (current > Number.MAX_SAFE_INTEGER - increment) {
    throw new Error("Authentication session epoch is exhausted");
  }
  return current + increment;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(key: string | Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
