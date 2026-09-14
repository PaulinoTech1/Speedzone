import { createHash } from "node:crypto";
import { getSecurityRedis } from "@/lib/redis";

export async function enforceRateLimit(request: Request, bucket: string, limit: number, windowSeconds: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const slot = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `speedzone:security-console:rate:${bucket}:${identity}:${slot}`;
  const redis = getSecurityRedis(); if (!redis) return { allowed: false, retryAfter: windowSeconds };
  const count = Number(await redis.incr(key)); if (count === 1) await redis.expire(key, windowSeconds + 1);
  return { allowed: count <= limit, retryAfter: windowSeconds };
}
