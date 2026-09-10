import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const V1 = "v1";
const V2 = "v2";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function configuredKey() {
  const value = process.env.TEST_DRIVE_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Test-drive encryption key is not configured");
  return Buffer.from(value, "base64url");
}
async function legacyKey(password: string, salt: Buffer) { return scrypt(password, salt, KEY_BYTES) as Promise<Buffer>; }
function encode(version: string, salt: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer) { return [version, salt.toString("base64url"), iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join("."); }

export async function encryptTestDrivePayload(payload: unknown) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = configuredKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return encode(V2, salt, iv, cipher.getAuthTag(), ciphertext);
}

export async function decryptTestDrivePayload<T>(encoded: string, legacyPassword?: string) {
  const [version, saltValue, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (!version || ![V1, V2].includes(version) || !saltValue || !ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted test-drive payload");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  const key = version === V2 ? configuredKey() : await legacyKey(legacyPassword || "", Buffer.from(saltValue, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
