import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const VERSION = "v1";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function deriveKey(password: string, salt: Buffer) {
  return scrypt(password, salt, KEY_BYTES) as Promise<Buffer>;
}

export async function encryptTestDrivePayload(payload: unknown, password: string) {
  if (!password) throw new Error("Admin encryption key is not configured");
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, salt.toString("base64url"), iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export async function decryptTestDrivePayload<T>(encoded: string, password: string) {
  const [version, saltValue, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (version !== VERSION || !saltValue || !ivValue || !tagValue || !ciphertextValue || !password) throw new Error("Invalid encrypted test-drive payload");
  const key = await deriveKey(password, Buffer.from(saltValue, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
