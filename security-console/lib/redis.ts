import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

export function securityRedisConfiguration() {
  const adminUrl = process.env.ADMIN_SECURITY_KV_REST_API_URL?.trim();
  const adminToken = process.env.ADMIN_SECURITY_KV_REST_API_TOKEN?.trim();
  const legacyUrl = process.env.SECURITY_KV_REST_API_URL?.trim();
  const legacyToken = process.env.SECURITY_KV_REST_API_TOKEN?.trim();
  // A partial dedicated pair must never borrow credentials from another store.
  const dedicated = Boolean(adminUrl || adminToken);
  const url = dedicated ? adminUrl : legacyUrl;
  const token = dedicated ? adminToken : legacyToken;
  const status = url && token ? "SET" : url || token ? "INVALID_PAIR" : "MISSING";
  return { status, source: dedicated ? "ADMIN_SECURITY" : url || token ? "SECURITY_LEGACY" : "NONE" } as const;
}

export function getSecurityRedis() {
  if (client !== undefined) return client;
  const configuration = securityRedisConfiguration();
  if (configuration.status !== "SET") return client = null;
  const prefix = configuration.source === "ADMIN_SECURITY" ? "ADMIN_SECURITY" : "SECURITY";
  try {
    client = new Redis({ url: process.env[`${prefix}_KV_REST_API_URL`]!.trim(), token: process.env[`${prefix}_KV_REST_API_TOKEN`]!.trim() });
  } catch { client = null; }
  return client;
}

export function resetSecurityRedisForTests() { client = undefined; }
