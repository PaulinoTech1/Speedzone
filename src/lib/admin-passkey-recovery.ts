import { createHash, randomBytes, randomInt } from "node:crypto";
import { Resend } from "resend";
import { getRedis } from "@/lib/redis";
import { recoveryConfigured, recoveryEmail, recoveryTokenKey } from "@/lib/admin-recovery";

// Lost-passkey recovery for the inventory admin.
//
// Threat model: possession of the recovery mailbox alone must never yield
// admin access. The emailed link can reset the password (see
// admin-recovery.ts), but a password session is refused while any passkey is
// current. Retiring every passkey requires, in order:
//   1. a fresh emailed recovery token (mailbox),
//   2. an offline single-use recovery code issued at passkey enrollment,
//   3. a 48-hour waiting period, announced to the recovery mailbox and
//      cancellable by any passkey session,
//   4. the admin password at the next sign-in, which executes the reset and
//      issues a five-minute setup session for one new passkey.
// See docs/admin-passkey-recovery.md.

export const PASSKEY_RESET_DELAY_MS = 48 * 60 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;
export const recoveryCodesKey = "speedzone:admin:recovery-codes";
export const passkeyResetKey = "speedzone:admin:passkey-reset";
export const passkeyReenrollKey = "speedzone:admin:passkey-reenroll";
export const passkeyEnrolledKey = "speedzone:admin:passkey-enrolled";
const credentialsKey = "speedzone:admin:passkeys";
const epochKey = "speedzone:admin-credential-epoch";
const generationKey = "speedzone:admin-session-generation";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRecoveryCode(value: unknown) {
  if (typeof value !== "string") return null;
  const compact = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NP-Z2-9]{20}$/.test(compact) ? compact : null;
}
export function hashRecoveryCode(normalized: string) { return createHash("sha256").update(`speedzone-admin-recovery-code:${normalized}`).digest("hex"); }

/** Generates a fresh set (replacing any previous set) and returns the plaintext once. */
export async function issueRecoveryCodes() {
  const redis = getRedis();
  if (!redis) return null;
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
    return raw.match(/.{5}/g)!.join("-");
  });
  await redis.set(recoveryCodesKey, codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code)!)).join(" "));
  return codes;
}

// Atomically: validate the emailed token, consume it, consume one matching
// recovery code, and record a pending reset. A wrong code also burns the
// token, so every guess costs a new email to the owner's mailbox.
const scheduleScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
local epoch = redis.call('GET', KEYS[2]) or '0'
redis.call('DEL', KEYS[1])
if tostring(record.epoch) ~= epoch then return 0 end
if redis.call('GET', KEYS[4]) then return -2 end
local codes = redis.call('GET', KEYS[3])
if not codes then return -1 end
local kept = {}
local found = false
for hash in string.gmatch(codes, '%S+') do
  if not found and hash == ARGV[1] then found = true else table.insert(kept, hash) end
end
if not found then return -1 end
redis.call('SET', KEYS[3], table.concat(kept, ' '))
redis.call('SET', KEYS[4], cjson.encode({ version = 1, requestedAt = tonumber(ARGV[2]), executeAt = tonumber(ARGV[3]) }))
return 1
`;
export async function schedulePasskeyReset(token: unknown, code: unknown, now = Date.now()) {
  const tokenKey = recoveryTokenKey(token);
  const normalized = normalizeRecoveryCode(code);
  if (!tokenKey || !normalized) return { status: "invalid" as const };
  const redis = getRedis(); if (!redis) return { status: "unavailable" as const };
  const executeAt = now + PASSKEY_RESET_DELAY_MS;
  try {
    const result = Number(await redis.eval(scheduleScript, [tokenKey, epochKey, recoveryCodesKey, passkeyResetKey], [hashRecoveryCode(normalized), String(now), String(executeAt)]));
    if (result === 1) return { status: "scheduled" as const, executeAt };
    if (result === -2) return { status: "already_pending" as const };
    return { status: "invalid" as const };
  } catch { return { status: "unavailable" as const }; }
}

export async function getPasskeyReset() {
  const redis = getRedis(); if (!redis) return null;
  const value = await redis.get<{ executeAt?: unknown; requestedAt?: unknown }>(passkeyResetKey);
  return value && typeof value.executeAt === "number" ? { executeAt: value.executeAt, requestedAt: typeof value.requestedAt === "number" ? value.requestedAt : null } : null;
}

/** Called only from an established passkey session. */
export async function cancelPasskeyReset() {
  const redis = getRedis(); if (!redis) return false;
  return Number(await redis.del(passkeyResetKey)) > 0;
}

// Runs after the password was verified. Retires every passkey, revokes all
// sessions, and permits exactly one initial enrollment, only when the waiting
// period has fully elapsed.
const executeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local pending = cjson.decode(raw)
if not pending.executeAt or tonumber(pending.executeAt) > tonumber(ARGV[1]) then return -1 end
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[3], redis.call('GET', KEYS[5]) or '0')
redis.call('SET', KEYS[4], ARGV[2])
return 1
`;
export async function executeDuePasskeyReset(now = Date.now()) {
  const redis = getRedis(); if (!redis) return "none" as const;
  const result = Number(await redis.eval(executeScript, [passkeyResetKey, credentialsKey, passkeyReenrollKey, generationKey, epochKey], [String(now), randomBytes(16).toString("hex")]));
  return result === 1 ? "executed" as const : result === -1 ? "waiting" as const : "none" as const;
}

/**
 * Password-only setup may enroll a passkey only on a never-enrolled install or
 * after a completed passkey reset. Stale (non-current) keys still count as
 * "enrolled": they are what a mailbox-only attacker would be trying to replace.
 */
export async function passwordSetupAllowed() {
  const redis = getRedis(); if (!redis) return false;
  const [credentials, enrolled, reenroll] = await Promise.all([redis.get<unknown>(credentialsKey), redis.get<unknown>(passkeyEnrolledKey), redis.get<unknown>(passkeyReenrollKey)]);
  if (reenroll !== null && reenroll !== undefined) return true;
  const hasAny = Array.isArray(credentials) && credentials.length > 0;
  return !hasAny && (enrolled === null || enrolled === undefined);
}

export async function notifyRecoveryMailbox(subject: string, text: string) {
  if (!recoveryConfigured()) return false;
  try {
    const { error } = await new Resend(process.env.RESEND_PASSWORD_RESET_API_KEY!).emails.send({ from: `SpeedZone Admin <admin@${process.env.RESEND_EMAIL_DOMAIN}>`, to: [recoveryEmail], subject, text });
    return !error;
  } catch { return false; }
}
