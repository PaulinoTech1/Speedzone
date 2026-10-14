import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/redis";
import { createHmac } from "node:crypto";
import { trustedClientIp } from "@/lib/test-drive-request";

const redis = getRedis();
const ipLimiter = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 h"), prefix: "speedzone:test-drive:ip", analytics: false, timeout: 2000 }) : null;
const contactLimiter = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 h"), prefix: "speedzone:test-drive:contact", analytics: false, timeout: 2000 }) : null;

export function getRequestKeys(request: Request, email: string, phone: string) {
  const ip = trustedClientIp(request.headers);
  const secret = process.env.TEST_DRIVE_ENCRYPTION_KEY;
  if (!secret) throw new Error("Contact protection is not configured");
  const digest = (value: string) => createHmac("sha256", secret).update(`rate-limit:${value}`).digest("hex");
  return {
    ip: digest(ip.toLowerCase()),
    contact: digest(`${email.toLowerCase()}:${phone.replace(/\D/g, "")}`),
  };
}

export async function limitTestDriveSubmission(keys: { ip: string; contact: string }) {
  if (!ipLimiter || !contactLimiter) return { success: false, configured: false, retryAfter: 3600 };
  let ipResult, contactResult;
  try { [ipResult, contactResult] = await Promise.all([ipLimiter.limit(keys.ip), contactLimiter.limit(keys.contact)]); }
  catch { return { success: false, configured: false, retryAfter: 30 }; }
  if (ipResult.reason === "timeout" || contactResult.reason === "timeout") return { success: false, configured: false, retryAfter: 30 };
  const reset = Math.max(...[ipResult, contactResult].filter(result => !result.success).map(result => result.reset), Date.now());
  return {
    success: ipResult.success && contactResult.success,
    configured: true,
    retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
