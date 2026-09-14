import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

export function getSecurityRedis() {
  if (client !== undefined) return client;
  const url = (process.env.ADMIN_SECURITY_KV_REST_API_URL || process.env.SECURITY_KV_REST_API_URL)?.trim();
  const token = (process.env.ADMIN_SECURITY_KV_REST_API_TOKEN || process.env.SECURITY_KV_REST_API_TOKEN)?.trim();
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export function resetSecurityRedisForTests() { client = undefined; }
