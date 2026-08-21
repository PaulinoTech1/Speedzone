import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

import { hmacSha256 } from "@/lib/server/crypto";
import { tokenConfig } from "@/lib/server/env";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function recoveryCode(): string {
  // The 32-character alphabet carries five bits per character. Twenty-six
  // characters therefore provide 130 bits of entropy before formatting.
  const bytes = randomBytes(26);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value.match(/.{1,5}/g)?.join("-") ?? value;
}

export function canonicalRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function recoveryCodeHash(value: string): string {
  return hmacSha256(tokenConfig().recoveryPepper, `recovery:${canonicalRecoveryCode(value)}`);
}

export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, recoveryCode);
  return { codes, hashes: codes.map(recoveryCodeHash) };
}

export function findRecoveryCodeHash(candidate: string, stored: string[]): string | null {
  const digest = Buffer.from(recoveryCodeHash(candidate), "hex");
  for (const hash of stored) {
    const storedDigest = Buffer.from(hash, "hex");
    if (storedDigest.length === digest.length && timingSafeEqual(storedDigest, digest)) return hash;
  }
  return null;
}
