import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";

const COOKIE_NAME = "speedzone_admin";
const SESSION_PREFIX = "speedzone:admin-session:";
const GENERATION_KEY = "speedzone:admin-session-generation";
const CREDENTIAL_EPOCH_KEY = "speedzone:admin-credential-epoch";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SESSION_IDLE_TTL_SECONDS = 60 * 30;
type AdminSession = { createdAt: number; lastSeenAt: number; generation: string; credentialEpoch: number; purpose: "setup" | "passkey" };
function sessionKey(token: string) { return `${SESSION_PREFIX}${createHash("sha256").update(token).digest("hex")}`; }
async function getCookieToken(request?: Request) {
  const rawCookie = request?.headers.get("cookie");
  const rawValue = rawCookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const value = rawValue ?? (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return undefined;
  try {
    return decodeURIComponent(value.replace(/^"|"$/g, ""));
  } catch {
    return undefined;
  }
}
async function generation() { const redis = getRedis(); if (!redis) return null; const current = await redis.get<string>(GENERATION_KEY); if (current) return current; const value = randomBytes(16).toString("hex"); const stored = await redis.set(GENERATION_KEY, value, { nx: true }); return stored ? value : redis.get<string>(GENERATION_KEY); }
const createSessionScript = `
local current = redis.call('GET', KEYS[2])
local credentialEpoch = redis.call('GET', KEYS[3])
if not current or current ~= ARGV[1] or not credentialEpoch or credentialEpoch ~= ARGV[4] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

const validateSessionScript = `
local raw = redis.call('GET', KEYS[1])
local current = redis.call('GET', KEYS[2])
if not raw or not current then return 0 end
local session = cjson.decode(raw)
if session.generation ~= current or tostring(session.credentialEpoch) ~= redis.call('GET', KEYS[3]) or session.purpose ~= ARGV[4] then return 0 end
local now = tonumber(ARGV[1])
local created = tonumber(session.createdAt)
local lastSeen = tonumber(session.lastSeenAt)
if not created or not lastSeen or now - created >= tonumber(ARGV[2]) or now - lastSeen >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return 0
end
session.lastSeenAt = now
local remaining = math.max(1, math.ceil((tonumber(ARGV[2]) - (now - created)) / 1000))
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', remaining)
return 1
`;

export async function createAdminSession(credentialEpoch: number, purpose: "setup" | "passkey") {
  const redis = getRedis();
  const current = await generation();
  if (!redis || !current) return null;
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const created = JSON.stringify({ createdAt: now, lastSeenAt: now, generation: current, credentialEpoch, purpose } satisfies AdminSession);
  try {
    const stored = await redis.eval(createSessionScript, [sessionKey(token), GENERATION_KEY, CREDENTIAL_EPOCH_KEY], [current, created, SESSION_TTL_SECONDS, credentialEpoch]);
    return Number(stored) === 1 ? token : null;
  } catch {
    return null;
  }
}

export async function isValidAdminSession(value: string | undefined) {
  if (!value || value.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const result = await redis.eval(validateSessionScript, [sessionKey(value), GENERATION_KEY, CREDENTIAL_EPOCH_KEY], [Date.now(), SESSION_TTL_SECONDS * 1000, SESSION_IDLE_TTL_SECONDS * 1000, "passkey"]);
    return Number(result) === 1;
  } catch {
    return false;
  }
}
async function isValidSessionPurpose(value: string | undefined, purpose: "setup" | "passkey") {
  if (!value || value.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const result = await redis.eval(validateSessionScript, [sessionKey(value), GENERATION_KEY, CREDENTIAL_EPOCH_KEY], [Date.now(), SESSION_TTL_SECONDS * 1000, SESSION_IDLE_TTL_SECONDS * 1000, purpose]);
    return Number(result) === 1;
  } catch { return false; }
}
export async function isAdmin(request?: Request) { return isValidSessionPurpose(await getCookieToken(request), "passkey"); }
export async function isAdminSetup(request?: Request) { return isValidSessionPurpose(await getCookieToken(request), "setup"); }
export async function isAdminAuthenticated(request?: Request) {
  const token = await getCookieToken(request);
  return isValidSessionPurpose(token, "passkey") || isValidSessionPurpose(token, "setup");
}
export async function revokeAdminSession(request?: Request) { const token = await getCookieToken(request); if (token) await getRedis()?.del(sessionKey(token)); }
export async function revokeAllAdminSessions() { const redis = getRedis(); if (redis) await redis.set(GENERATION_KEY, randomBytes(16).toString("hex")); }
export const adminCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };
export function clearAdminCookie() { return { name: COOKIE_NAME, value: "", maxAge: 0 }; }
export function adminCookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_TTL_SECONDS }; }
export function privateResponseHeaders() { return { "Cache-Control": "private, no-store, max-age=0" }; }
