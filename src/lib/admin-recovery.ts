import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { del, list } from "@vercel/blob";
import { Redis } from "@upstash/redis";

const TOKEN_TTL_SECONDS = 15 * 60;
const PASSWORD_KEY = "speedzone:admin-password-override";
const TOKEN_PREFIX = "speedzone:admin-recovery:";
function getRedis() { const url = process.env.KV_REST_API_URL; const token = process.env.KV_REST_API_TOKEN; return url && token ? new Redis({ url, token }) : null; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function recoveryConfigured() { return Boolean(getRedis() && process.env.RESEND_PASSWORD_RESET_API_KEY && process.env.RESEND_EMAIL_DOMAIN); }
export async function createRecoveryToken() { const redis = getRedis(); if (!redis) return null; const token = randomBytes(32).toString("base64url"); await redis.set(`${TOKEN_PREFIX}${hash(token)}`, "1", { ex: TOKEN_TTL_SECONDS, nx: true }); return token; }
export async function consumeRecoveryToken(token: string) { const redis = getRedis(); if (!redis || !token) return false; const deleted = await redis.eval("local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); return 1 else return 0 end", [`${TOKEN_PREFIX}${hash(token)}`], []); return Number(deleted) === 1; }
export async function setAdminPassword(password: string) { const redis = getRedis(); if (!redis) return false; await redis.set(PASSWORD_KEY, await argon2.hash(password, { type: argon2.argon2id })); return true; }
export async function getAdminPassword() { return process.env.SPEEDZONE_ADMIN_PASSWORD; }
export async function verifyAdminPassword(password: string) { const stored = await getRedis()?.get<string>(PASSWORD_KEY); if (stored?.startsWith("$argon2") && await argon2.verify(stored, password)) return true; return password === process.env.SPEEDZONE_ADMIN_PASSWORD; }
export async function deleteAllTestDriveSubmissions() { const token = process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN; if (!token) return false; let cursor: string | undefined; do { const page = await list({ prefix: "test-drive/", token, limit: 1000, ...(cursor ? { cursor } : {}) }); if (page.blobs.length) await del(page.blobs.map((blob) => blob.pathname), { token }); cursor = page.hasMore ? page.cursor : undefined; } while (cursor); return true; }
export const recoveryTtlSeconds = TOKEN_TTL_SECONDS;
export const recoveryEmail = "alex@paulinotech.com";
export const recoveryTokenKey = TOKEN_PREFIX;
export function recoveryHash(value: string) { return hash(value); }
