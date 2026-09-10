import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { getRedis } from "@/lib/redis";

export const recoveryEmail = "admin@speedzonemotorsports.com";
export const recoveryTtlSeconds = 15 * 60;
const tokenPrefix = "speedzone:admin-recovery:";
const credentialKey = "speedzone:admin-credential:v2";
const tokenLength = 43;

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function recoveryConfigured() { return Boolean(process.env.RESEND_PASSWORD_RESET_API_KEY && process.env.RESEND_EMAIL_DOMAIN); }

export async function createRecoveryToken() {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomBytes(32).toString("base64url");
  try {
    await redis.set(`${tokenPrefix}${hashToken(token)}`, "1", { ex: recoveryTtlSeconds, nx: true });
    return token;
  } catch { return null; }
}

export async function consumeRecoveryToken(token: unknown) {
  if (typeof token !== "string" || token.length !== tokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) return { status: "invalid_or_expired" as const };
  const redis = getRedis();
  if (!redis) return { status: "storage_unavailable" as const };
  try {
    const deleted = await redis.eval("local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); return 1 else return 0 end", [`${tokenPrefix}${hashToken(token)}`], []);
    return Number(deleted) === 1 ? { status: "consumed" as const } : { status: "invalid_or_expired" as const };
  } catch { return { status: "storage_unavailable" as const }; }
}

export async function setAdminPassword(password: string) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await redis.set(credentialKey, hash);
    return true;
  } catch { return false; }
}

export async function verifyAdminPassword(password: string) {
  const redis = getRedis();
  const stored = redis ? await redis.get<string>(credentialKey) : null;
  if (stored) {
    try { return await argon2.verify(stored, password); } catch { return false; }
  }
  const bootstrap = process.env.SPEEDZONE_ADMIN_PASSWORD;
  if (!bootstrap) return false;
  const valid = password === bootstrap;
  if (valid && redis) await setAdminPassword(password);
  return valid;
}
