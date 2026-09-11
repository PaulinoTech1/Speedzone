import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { getRedis } from "@/lib/redis";

export const recoveryEmail = "admin@speedzonemotorsports.com";
export const recoveryTtlSeconds = 15 * 60;
const tokenPrefix = "speedzone:admin-recovery:v2:";
const credentialKey = "speedzone:admin-credential:v2";
const legacyOverrideKey = "speedzone:admin-password-override";
const legacyCredentialKey = "speedzone:admin-credential";
const credentialStateKey = "speedzone:admin-credential-state:v1";
const epochKey = "speedzone:admin-credential-epoch";
const tokenLength = 43;

type CredentialSnapshot = {
  current: string | null;
  legacyOverride: string | null;
  legacyCredential: string | null;
  state: string | null;
  epoch: string | null;
};
export type CredentialState = "fresh" | "current_complete" | "current_missing_metadata" | "legacy" | "conflicting" | "corrupt" | "unavailable";
export type PasswordVerification =
  | { verified: true; credentialEpoch: number }
  | { verified: false; reason: "invalid" | "recovery_required" | "unavailable" };

const snapshotScript = "return {redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2]), redis.call('GET', KEYS[3]), redis.call('GET', KEYS[4]), redis.call('GET', KEYS[5])}";
const initializeScript = `
local current = redis.call('GET', KEYS[1]); local override = redis.call('GET', KEYS[2]); local legacy = redis.call('GET', KEYS[3]); local state = redis.call('GET', KEYS[4]); local epoch = redis.call('GET', KEYS[5])
if current or override or legacy or state == 'initialized' or (state and state ~= 'uninitialized') or (epoch and epoch ~= '' and epoch ~= '0') then return 0 end
redis.call('SET', KEYS[1], ARGV[1]); redis.call('SET', KEYS[4], 'initialized'); redis.call('SET', KEYS[5], '1'); return 1
`;
const migrateLegacyScript = `
local current = redis.call('GET', KEYS[1]); local selected = redis.call('GET', KEYS[2]); local other = redis.call('GET', KEYS[3]); local state = redis.call('GET', KEYS[4]); local epoch = redis.call('GET', KEYS[5])
if current or not selected or selected ~= ARGV[1] or (other and other ~= ARGV[1]) or state == 'initialized' or (state and state ~= 'uninitialized') or (epoch and epoch ~= '' and epoch ~= '0') then return 0 end
redis.call('SET', KEYS[1], ARGV[2]); redis.call('SET', KEYS[4], 'initialized'); redis.call('SET', KEYS[5], '1'); redis.call('DEL', KEYS[2]); redis.call('DEL', KEYS[3]); return 1
`;
const backfillScript = `
local current = redis.call('GET', KEYS[1]); local state = redis.call('GET', KEYS[2]); local epoch = redis.call('GET', KEYS[3])
if current ~= ARGV[1] then return 0 end
if epoch and epoch ~= '' and epoch ~= '0' and (not string.match(epoch, '^%d+$') or tonumber(epoch) < 0) then return 0 end
if state and state ~= 'initialized' and state ~= 'uninitialized' then return 0 end
if not epoch or epoch == '' or epoch == '0' then redis.call('SET', KEYS[3], '1'); epoch = '1' end
if not state or state == 'uninitialized' then redis.call('SET', KEYS[2], 'initialized') end
return tonumber(epoch)
`;

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function parseCredentialEpoch(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value ? parsed : null;
}

function parseSnapshot(value: unknown): CredentialSnapshot | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const rawEpoch = value[4];
  const parsedEpoch = rawEpoch == null ? null : parseCredentialEpoch(rawEpoch);
  return { current: value[0] == null ? null : String(value[0]), legacyOverride: value[1] == null ? null : String(value[1]), legacyCredential: value[2] == null ? null : String(value[2]), state: value[3] == null ? null : String(value[3]), epoch: rawEpoch == null ? null : parsedEpoch === null ? String(rawEpoch) : String(parsedEpoch) };
}
function validEpoch(value: string | null): value is string {
  return parseCredentialEpoch(value) !== null;
}
function classify(snapshot: CredentialSnapshot): CredentialState {
  const hasLegacy = Boolean(snapshot.legacyOverride || snapshot.legacyCredential);
  if ((snapshot.state !== null && snapshot.state !== "initialized" && snapshot.state !== "uninitialized") || (snapshot.epoch !== null && !validEpoch(snapshot.epoch))) return "corrupt";
  if (snapshot.legacyOverride && snapshot.legacyCredential && snapshot.legacyOverride !== snapshot.legacyCredential) return "conflicting";
  if (snapshot.current) return snapshot.state === "initialized" && snapshot.epoch !== null && validEpoch(snapshot.epoch) ? "current_complete" : "current_missing_metadata";
  if (hasLegacy) return "legacy";
  return snapshot.state === "initialized" || snapshot.epoch !== null ? "corrupt" : "fresh";
}
function keys() { return [credentialKey, legacyOverrideKey, legacyCredentialKey, credentialStateKey, epochKey]; }
async function snapshot(redis: NonNullable<ReturnType<typeof getRedis>>) { return parseSnapshot(await redis.eval(snapshotScript, keys(), [])); }

export function recoveryConfigured() { return Boolean(process.env.RESEND_PASSWORD_RESET_API_KEY && process.env.RESEND_EMAIL_DOMAIN); }
const consumeRecoveryTokenScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
local epoch = redis.call('GET', KEYS[2]) or '0'
if tostring(record.epoch) ~= epoch then redis.call('DEL', KEYS[1]); return -1 end
redis.call('DEL', KEYS[1])
return 1
`;
const commitRecoveryScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
local epoch = redis.call('GET', KEYS[2]) or '0'
if tostring(record.epoch) ~= epoch then redis.call('DEL', KEYS[1]); return -1 end
local nextEpoch = tonumber(epoch) + 1
redis.call('SET', KEYS[3], ARGV[1])
redis.call('SET', KEYS[4], 'initialized')
redis.call('SET', KEYS[2], tostring(nextEpoch))
redis.call('DEL', KEYS[1])
return nextEpoch
`;

export async function createRecoveryToken() {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomBytes(32).toString("base64url");
  try {
    const epoch = await getCredentialEpoch();
    if (!epoch) return null;
    const record = JSON.stringify({ version: 2, epoch, issuedAt: Date.now() });
    await redis.set(`${tokenPrefix}${hashToken(token)}`, record, { ex: recoveryTtlSeconds, nx: true });
    return token;
  } catch { return null; }
}

export async function consumeRecoveryToken(token: unknown) {
  if (typeof token !== "string" || token.length !== tokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) return { status: "invalid_or_expired" as const };
  const redis = getRedis(); if (!redis) return { status: "storage_unavailable" as const };
  try {
    const consumed = await redis.eval(consumeRecoveryTokenScript, [`${tokenPrefix}${hashToken(token)}`, epochKey], []);
    return Number(consumed) === 1 ? { status: "consumed" as const } : { status: "invalid_or_expired" as const };
  } catch { return { status: "storage_unavailable" as const }; }
}

export async function resetAdminPasswordWithToken(token: unknown, password: string) {
  if (typeof token !== "string" || token.length !== tokenLength || !/^[A-Za-z0-9_-]+$/.test(token) || password.length < 12 || password.length > 128) return { status: "invalid" as const };
  const redis = getRedis(); if (!redis) return { status: "storage_unavailable" as const };
  try {
    const hash = await hashPassword(password);
    const result = await redis.eval(commitRecoveryScript, [`${tokenPrefix}${hashToken(token)}`, epochKey, credentialKey, credentialStateKey], [hash]);
    if (Number(result) === 0 || Number(result) === -1) return { status: "invalid_or_expired" as const };
    return { status: "committed" as const, credentialEpoch: Number(result) };
  } catch { return { status: "storage_unavailable" as const }; }
}
async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id }); }
export async function replaceAdminPassword(password: string) { const redis = getRedis(); if (!redis || password.length < 12) return null; try { const hash = await hashPassword(password); const result = await redis.eval("local e = tonumber(redis.call('GET', KEYS[2]) or '0') + 1; redis.call('SET', KEYS[1], ARGV[1]); redis.call('SET', KEYS[3], 'initialized'); redis.call('SET', KEYS[2], tostring(e)); return e", [credentialKey, epochKey, credentialStateKey], [hash]); return Number(result) > 0 ? Number(result) : null; } catch { return null; } }
export async function getCredentialEpoch() {
  const redis = getRedis();
  if (!redis) return null;
  return parseCredentialEpoch(await redis.get<unknown>(epochKey));
}

export async function verifyAdminPassword(password: string): Promise<PasswordVerification> {
  if (typeof password !== "string" || password.length > 256) return { verified: false, reason: "invalid" };
  const redis = getRedis(); if (!redis) return { verified: false, reason: "unavailable" };
  try {
    const snap = await snapshot(redis); if (!snap) return { verified: false, reason: "unavailable" };
    const state = classify(snap); if (state === "conflicting" || state === "corrupt") return { verified: false, reason: "recovery_required" };
    if (state === "current_complete" || state === "current_missing_metadata") {
      let valid = false; try { valid = await argon2.verify(snap.current!, password); } catch { return { verified: false, reason: "recovery_required" }; }
      if (!valid) return { verified: false, reason: "invalid" };
      if (state === "current_missing_metadata") {
        const result = await redis.eval(backfillScript, [credentialKey, credentialStateKey, epochKey], [snap.current!]);
        if (Number(result) <= 0) return { verified: false, reason: "recovery_required" };
        return { verified: true, credentialEpoch: Number(result) };
      }
      if (!snap.epoch || !validEpoch(snap.epoch)) return { verified: false, reason: "recovery_required" };
      return { verified: true, credentialEpoch: Number(snap.epoch) };
    }
    if (state === "legacy") {
      const selected = snap.legacyOverride ?? snap.legacyCredential; if (!selected || (snap.legacyOverride && snap.legacyCredential && snap.legacyOverride !== snap.legacyCredential) || selected !== password) return { verified: false, reason: "invalid" };
      const hash = await hashPassword(password);
      const other = snap.legacyOverride ? legacyCredentialKey : legacyOverrideKey;
      const result = await redis.eval(migrateLegacyScript, [credentialKey, snap.legacyOverride ? legacyOverrideKey : legacyCredentialKey, other, credentialStateKey, epochKey], [selected, hash]);
      if (Number(result) !== 1) return { verified: false, reason: "recovery_required" };
      return { verified: true, credentialEpoch: 1 };
    }
    const bootstrap = process.env.SPEEDZONE_ADMIN_PASSWORD; if (!bootstrap || password !== bootstrap) return { verified: false, reason: "invalid" };
    const hash = await hashPassword(password);
    const result = await redis.eval(initializeScript, keys(), [hash]);
    if (Number(result) === 1) return { verified: true, credentialEpoch: 1 };
    return { verified: false, reason: "recovery_required" };
  } catch { return { verified: false, reason: "unavailable" }; }
}
