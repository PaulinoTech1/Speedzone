import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { getRedis } from "@/lib/redis";

export const recoveryEmail = "admin@speedzonemotorsports.com";
export const recoveryTtlSeconds = 15 * 60;
const tokenPrefix = "speedzone:admin-recovery:";
const credentialKey = "speedzone:admin-credential:v2";
const legacyCredentialKeys = ["speedzone:admin-password-override", "speedzone:admin-credential"];
const credentialStateKey = "speedzone:admin-credential-state:v1";
const tokenLength = 43;

type CredentialState = "uninitialized" | "initialized";
export type PasswordVerification =
  | { verified: true; credentialEpoch: number }
  | { verified: false; reason: "invalid" | "recovery_required" | "unavailable" }; 
const epochKey = "speedzone:admin-credential-epoch";
const commitCredentialScript = `
local current = redis.call('GET', KEYS[1])
local legacy = redis.call('GET', KEYS[2])
local state = redis.call('GET', KEYS[3])
local epoch = redis.call('GET', KEYS[4])
if current or legacy or state == 'initialized' or (ARGV[1] ~= '' and epoch ~= ARGV[1]) then return 0 end
local nextEpoch = tonumber(epoch or '0') + 1
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[3], 'initialized')
redis.call('SET', KEYS[4], tostring(nextEpoch))
return nextEpoch
`;
const replaceCredentialScript = `
local nextEpoch = tonumber(redis.call('GET', KEYS[2]) or '0') + 1
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], 'initialized')
redis.call('SET', KEYS[2], tostring(nextEpoch))
return nextEpoch
`;

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

async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function setAdminPassword(password: string, expectedEpoch?: number) {
  const redis = getRedis();
  if (!redis || password.length < 12) return null;
  try {
    const hash = await hashPassword(password);
    const keys = [credentialKey, legacyCredentialKeys[0]!, credentialStateKey, epochKey];
    const args = [expectedEpoch === undefined ? "" : String(expectedEpoch), hash];
    const result = await redis.eval(commitCredentialScript, keys, args);
    return Number(result) > 0 ? Number(result) : null;
  } catch { return null; }
}

export async function replaceAdminPassword(password: string) {
  const redis = getRedis();
  if (!redis || password.length < 12) return null;
  try {
    const hash = await hashPassword(password);
    const result = await redis.eval(replaceCredentialScript, [credentialKey, epochKey, credentialStateKey], [hash]);
    return Number(result) > 0 ? Number(result) : null;
  } catch { return null; }
}

async function getStoredCredential(redis: NonNullable<ReturnType<typeof getRedis>>) {
  const current = await redis.get<string>(credentialKey);
  if (current) return current;
  for (const key of legacyCredentialKeys) {
    const legacy = await redis.get<string>(key);
    if (legacy) return legacy;
  }
  return null;
}

export async function getCredentialEpoch() {
  const redis = getRedis();
  if (!redis) return null;
  const value = await redis.get<string>(epochKey);
  return value ? Number(value) : 0;
}

export async function verifyAdminPassword(password: string): Promise<PasswordVerification> {
  const redis = getRedis();
  if (!redis) return { verified: false, reason: "unavailable" };
  try {
    const current = await redis.get<string>(credentialKey);
    const state = await redis.get<CredentialState>(credentialStateKey);
    const epoch = await getCredentialEpoch();
    if (current) {
      try {
        return await argon2.verify(current, password)
          ? { verified: true, credentialEpoch: epoch ?? 0 }
          : { verified: false, reason: "invalid" };
      } catch {
        return { verified: false, reason: "recovery_required" };
      }
    }
    if (state === "initialized") return { verified: false, reason: "recovery_required" };
    const legacy = await getStoredCredential(redis);
    if (legacy && legacy === password) {
      const migrated = await setAdminPassword(password, epoch ?? 0);
      return migrated ? { verified: true, credentialEpoch: migrated } : { verified: false, reason: "invalid" };
    }
    const bootstrap = process.env.SPEEDZONE_ADMIN_PASSWORD;
    if (!bootstrap || password !== bootstrap) return { verified: false, reason: "invalid" };
    const migrated = await setAdminPassword(password, epoch ?? 0);
    return migrated ? { verified: true, credentialEpoch: migrated } : { verified: false, reason: "invalid" };
  } catch {
    return { verified: false, reason: "unavailable" };
  }
}
