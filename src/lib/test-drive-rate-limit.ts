import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;
const ipLimiter = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 h"), prefix: "speedzone:test-drive:ip", analytics: true }) : null;
const contactLimiter = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 h"), prefix: "speedzone:test-drive:contact", analytics: true }) : null;

export function getRequestKeys(request: Request, email: string, phone: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  return {
    ip: ip.toLowerCase(),
    contact: `${email.toLowerCase()}:${phone.replace(/\D/g, "")}`,
  };
}

export async function limitTestDriveSubmission(keys: { ip: string; contact: string }) {
  if (!ipLimiter || !contactLimiter) return { success: false, configured: false, retryAfter: 3600 };
  const [ipResult, contactResult] = await Promise.all([ipLimiter.limit(keys.ip), contactLimiter.limit(keys.contact)]);
  const reset = Math.min(ipResult.reset, contactResult.reset);
  return {
    success: ipResult.success && contactResult.success,
    configured: true,
    retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
