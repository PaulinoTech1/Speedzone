import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "speedzone_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret() {
  return process.env.SPEEDZONE_ADMIN_PASSWORD;
}

function sign(value: string) {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = sign(payload);
  if (!signature) return null;
  return `${payload}.${signature}`;
}

export function isValidAdminSession(value: string | undefined) {
  if (!value) return false;
  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature || Number.isNaN(Number(expiresAt)) || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(expiresAt);
  if (!expected || expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function isAdmin() {
  return isValidAdminSession((await cookies()).get(COOKIE_NAME)?.value);
}

export const adminCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_TTL_SECONDS,
};

export function clearAdminCookie() {
  return { name: COOKIE_NAME, value: "", maxAge: 0 };
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function privateResponseHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
