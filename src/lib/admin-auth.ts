import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";

const COOKIE_NAME = "speedzone_admin";
const SESSION_PREFIX = "speedzone:admin-session:";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SESSION_IDLE_TTL_SECONDS = 60 * 30;

type AdminSession = { createdAt: number; lastSeenAt: number };

function sessionKey(token: string) {
  return `${SESSION_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

async function getCookieToken(request?: Request) {
  if (request) return request.headers.get("cookie")?.match(/(?:^|;\s*)speedzone_admin=([^;]+)/)?.[1];
  return (await cookies()).get(COOKIE_NAME)?.value;
}

export async function createAdminSession() {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await redis.set(sessionKey(token), { createdAt: now, lastSeenAt: now } satisfies AdminSession, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function isValidAdminSession(value: string | undefined) {
  if (!value) return false;
  const redis = getRedis();
  if (!redis) return false;
  const session = await redis.get<AdminSession>(sessionKey(value));
  if (!session) return false;
  const now = Date.now();
  const absoluteExpired = now - session.createdAt >= SESSION_TTL_SECONDS * 1000;
  const idleExpired = now - session.lastSeenAt >= SESSION_IDLE_TTL_SECONDS * 1000;
  if (absoluteExpired || idleExpired) {
    await redis.del(sessionKey(value));
    return false;
  }
  const remaining = Math.max(1, Math.ceil((SESSION_TTL_SECONDS * 1000 - (now - session.createdAt)) / 1000));
  await redis.set(sessionKey(value), { ...session, lastSeenAt: now }, { ex: remaining });
  return true;
}

export async function isAdmin(request?: Request) {
  return isValidAdminSession(await getCookieToken(request));
}

export async function revokeAdminSession(request?: Request) {
  const token = await getCookieToken(request);
  if (token) await getRedis()?.del(sessionKey(token));
}

export async function revokeAllAdminSessions() {
  const redis = getRedis();
  if (!redis) return;
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: `${SESSION_PREFIX}*`, count: 100 });
    cursor = Number(nextCursor);
    if (keys.length) await redis.del(...keys);
  } while (cursor !== 0);
}

export const adminCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };

export function clearAdminCookie() {
  return { name: COOKIE_NAME, value: "", maxAge: 0 };
}

export function adminCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_TTL_SECONDS };
}

export function privateResponseHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
