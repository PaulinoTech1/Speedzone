import { createHash, randomBytes } from "node:crypto";
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

export const recoveryTtlSeconds = TOKEN_TTL_SECONDS;
export const recoveryEmail = "alex@paulinotech.com";
export const recoveryTokenKey = TOKEN_PREFIX;
export function recoveryHash(value: string) { return hash(value); }
