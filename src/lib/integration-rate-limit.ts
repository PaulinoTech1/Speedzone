import { Ratelimit } from "@upstash/ratelimit";
import { createHmac } from "node:crypto";
import { getRedis } from "@/lib/redis";

const limiters = new Map<string, Ratelimit | null>();
function limiter(prefix: string, max: number, window: `${number} m`) {
  if (!limiters.has(prefix)) {
    const redis = getRedis();
    limiters.set(prefix, redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(max, window), prefix, analytics: false, timeout: 2000 }) : null);
  }
  return limiters.get(prefix)!;
}

/** Keyed network identifier: raw IPs are never stored (SECURITY.md). */
export function networkKey(request: Request, purpose: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().toLowerCase() || request.headers.get("x-real-ip") || "unknown";
  const secret = process.env.SECURITY_IP_HASH_SECRET || process.env.META_FEED_TOKEN || "speedzone-rate-limit";
  return createHmac("sha256", secret).update(`${purpose}:${ip}`).digest("hex").slice(0, 32);
}

export type LimitResult = { allowed: boolean; retryAfter: number };

/** Fail closed: an unconfigured or unreachable limiter denies. */
async function consume(instance: Ratelimit | null, key: string): Promise<LimitResult> {
  if (!instance) return { allowed: false, retryAfter: 60 };
  try {
    const result = await instance.limit(key);
    if (result.reason === "timeout") return { allowed: false, retryAfter: 30 };
    return { allowed: result.success, retryAfter: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)) };
  } catch { return { allowed: false, retryAfter: 30 }; }
}

/** Admin CSV import: 30 preview/apply requests per 10 minutes. */
export const limitInventoryImport = () => consume(limiter("speedzone:inventory-import", 30, "10 m"), "admin");

/** Catalog feed: 10 failed token attempts per 15 minutes per network. */
export async function feedFailuresBlocked(key: string) {
  const instance = limiter("speedzone:feed-failures", 10, "15 m");
  if (!instance) return { blocked: true, retryAfter: 60 };
  try {
    const remaining = await instance.getRemaining(key);
    return { blocked: remaining.remaining <= 0, retryAfter: Math.max(1, Math.ceil((remaining.reset - Date.now()) / 1000)) };
  } catch { return { blocked: true, retryAfter: 30 }; }
}
export const recordFeedFailure = (key: string) => consume(limiter("speedzone:feed-failures", 10, "15 m"), key);
