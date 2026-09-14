import { timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { getSecurityRedis } from "./redis";
import { migrateLegacyPasskeys } from "./legacy-passkeys";

const CREDENTIAL_KEY = "speedzone:security-console:credential:v1";
const EPOCH_KEY = "speedzone:security-console:credential-epoch:v1";
const LEGACY_CREDENTIAL_KEY = "speedzone:security-console:password";
const LEGACY_EPOCH_KEY = "speedzone:security-console:credential-epoch";

export type PasswordResult = { ok: true; epoch: number; migrated?: true } | { ok: false; reason: "invalid" | "unavailable" | "already_configured" };

export async function isPasswordConfigured() {
  const redis = getSecurityRedis();
  if (!redis) return null;
  const [current, legacy] = await Promise.all([redis.get(CREDENTIAL_KEY), redis.get(LEGACY_CREDENTIAL_KEY)]);
  return Boolean(current || legacy);
}

export async function initializePassword(bootstrapToken: string, password: string): Promise<PasswordResult> {
  const expected = process.env.SECURITY_BOOTSTRAP_TOKEN?.trim();
  if (!expected || !safeEqual(bootstrapToken, expected) || !validPassword(password)) return { ok: false, reason: "invalid" };
  const redis = getSecurityRedis();
  if (!redis) return { ok: false, reason: "unavailable" };
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const result = await redis.eval(
    "if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end; redis.call('SET', KEYS[1], ARGV[1]); redis.call('SET', KEYS[2], '1'); return 1",
    [CREDENTIAL_KEY, EPOCH_KEY, LEGACY_CREDENTIAL_KEY], [hash],
  );
  return Number(result) === 1 ? { ok: true, epoch: 1 } : { ok: false, reason: "already_configured" };
}

export async function verifyPassword(password: string): Promise<PasswordResult> {
  if (typeof password !== "string" || password.length > 256) return { ok: false, reason: "invalid" };
  const redis = getSecurityRedis();
  if (!redis) return { ok: false, reason: "unavailable" };
  const [hash, rawEpoch] = await Promise.all([redis.get<string>(CREDENTIAL_KEY), redis.get<string>(EPOCH_KEY)]);
  const epoch = Number(rawEpoch);
  try {
    if (hash && Number.isSafeInteger(epoch) && epoch > 0) {
      if (!await argon2.verify(hash, password)) return { ok: false, reason: "invalid" };
      await migrateLegacyPasskeys(password, epoch, hash);
      return { ok: true, epoch };
    }

    const [legacyHash, rawLegacyEpoch] = await Promise.all([redis.get<string>(LEGACY_CREDENTIAL_KEY), redis.get<string>(LEGACY_EPOCH_KEY)]);
    const legacyEpoch = Number(rawLegacyEpoch);
    if (!legacyHash || !Number.isSafeInteger(legacyEpoch) || legacyEpoch < 1 || !await argon2.verify(legacyHash, password)) return { ok: false, reason: "invalid" };

    const upgradedHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    const migratedEpoch = Number(await redis.eval(
      "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end; if redis.call('GET', KEYS[3]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2]); redis.call('SET', KEYS[2], ARGV[3]); return tonumber(ARGV[3])",
      [CREDENTIAL_KEY, EPOCH_KEY, LEGACY_CREDENTIAL_KEY],
      [legacyHash, upgradedHash, String(legacyEpoch)],
    ));
    if (!Number.isSafeInteger(migratedEpoch) || migratedEpoch < 1) return { ok: false, reason: "unavailable" };
    await migrateLegacyPasskeys(password, migratedEpoch, upgradedHash);
    return { ok: true, epoch: migratedEpoch, migrated: true };
  }
  catch { return { ok: false, reason: "unavailable" }; }
}

export async function currentCredentialEpoch() {
  const value = await getSecurityRedis()?.get<string>(EPOCH_KEY);
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : null;
}

export function validPassword(value: string) {
  return typeof value === "string" && value.length >= 16 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
