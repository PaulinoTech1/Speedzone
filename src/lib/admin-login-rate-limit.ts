import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

let limiter: Ratelimit | null | undefined;

function getLimiter() {
  if (limiter !== undefined) return limiter;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    limiter = null;
    return limiter;
  }
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(MAX_ATTEMPTS, `${WINDOW_SECONDS} s`),
    prefix: "speedzone:admin-login",
  });
  return limiter;
}

export async function checkAdminLoginRateLimit(identifier: string) {
  const currentLimiter = getLimiter();
  if (!currentLimiter) return { success: false, retryAfter: WINDOW_SECONDS, configured: false };
  const result = await currentLimiter.limit(identifier);
  return {
    success: result.success,
    retryAfter: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    configured: true,
  };
}
