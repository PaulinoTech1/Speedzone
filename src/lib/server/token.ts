import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { tokenConfig } from "@/lib/server/env";

const aad = Buffer.from("speedzone-auth-token-v1", "utf8");

function keyBytes(value: string, name: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32) throw new Error(`${name} must decode to at least 32 bytes in base64url form`);
  return createHash("sha256").update(decoded).digest();
}

function signature(value: string): Buffer {
  const { signingKey } = tokenConfig();
  return createHmac("sha256", keyBytes(signingKey, "AUTH_SIGNING_KEY")).update(value).digest();
}

export function sealToken(payload: object): string {
  const { encryptionKey } = tokenConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(encryptionKey, "AUTH_ENCRYPTION_KEY"), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const encrypted = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  const unsigned = `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}`;
  return `${unsigned}.${signature(unsigned).toString("base64url")}`;
}

export function openToken<T>(token: string | undefined): T | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [version, ivPart, encryptedPart, signaturePart] = parts;
  const unsigned = `${version}.${ivPart}.${encryptedPart}`;

  try {
    const providedSignature = Buffer.from(signaturePart ?? "", "base64url");
    const expectedSignature = signature(unsigned);
    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      return null;
    }

    const encrypted = Buffer.from(encryptedPart ?? "", "base64url");
    if (encrypted.length <= 16) return null;
    const ciphertext = encrypted.subarray(0, -16);
    const tag = encrypted.subarray(-16);
    const { encryptionKey } = tokenConfig();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyBytes(encryptionKey, "AUTH_ENCRYPTION_KEY"),
      Buffer.from(ivPart ?? "", "base64url"),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
