import { createHash, randomBytes } from "node:crypto";
import { del, list } from "@vercel/blob";
import { Redis } from "@upstash/redis";

const TOKEN_TTL_SECONDS = 15 * 60;
const PASSWORD_KEY = "speedzone:admin-password-override";
const TOKEN_PREFIX = "speedzone:admin-recovery:";

function getRedis() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function recoveryConfigured() {
  return Boolean(getRedis() && process.env.RESEND_PASSWORD_RESET_API_KEY && process.env.RESEND_EMAIL_DOMAIN);
}

export async function createRecoveryToken() {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomBytes(32).toString("base64url");
  await redis.set(`${TOKEN_PREFIX}${hash(token)}`, "1", { ex: TOKEN_TTL_SECONDS });
  return token;
}

export async function consumeRecoveryToken(token: string) {
  const redis = getRedis();
  if (!redis || !token) return false;
  const key = `${TOKEN_PREFIX}${hash(token)}`;
  const exists = await redis.get<string>(key);
  if (!exists) return false;
  await redis.del(key);
  return true;
}

export async function setAdminPassword(password: string) {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set(PASSWORD_KEY, password);
  return true;
}

export async function getAdminPassword() {
  const redis = getRedis();
  const override = redis ? await redis.get<string>(PASSWORD_KEY) : null;
  return override || process.env.SPEEDZONE_ADMIN_PASSWORD;
}

export async function getAdminPasswordCandidates() {
  const configuredPassword = process.env.SPEEDZONE_ADMIN_PASSWORD;
  const redis = getRedis();
  const override = redis ? await redis.get<string>(PASSWORD_KEY) : null;
  return [...new Set([configuredPassword, override].filter((value): value is string => Boolean(value)))];
}

export async function deleteAllTestDriveSubmissions() {
  const token = process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;

  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "test-drive/", token, limit: 1000, ...(cursor ? { cursor } : {}) });
    if (page.blobs.length) await del(page.blobs.map((blob) => blob.pathname), { token });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return true;
}

export const recoveryTtlSeconds = TOKEN_TTL_SECONDS;
export const recoveryEmail = "alex@paulinotech.com";
export const recoveryTokenKey = TOKEN_PREFIX;
export function recoveryHash(value: string) { return hash(value); }
