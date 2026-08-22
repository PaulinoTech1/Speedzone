import "server-only";

export const ratePolicies = {
  bootstrap: { limit: 3, windowMs: 30 * 60_000 },
  password: { limit: 5, windowMs: 15 * 60_000 },
  webauthn: { limit: 10, windowMs: 15 * 60_000 },
  passkeyManagement: { limit: 5, windowMs: 60 * 60_000 },
  recovery: { limit: 5, windowMs: 60 * 60_000 },
  inventory: { limit: 120, windowMs: 60_000 },
  benchmark: { limit: 1, windowMs: 60 * 60_000 },
  testDrive: { limit: 5, windowMs: 60 * 60_000 },
  tradeIn: { limit: 5, windowMs: 60 * 60_000 },
  vinDecode: { limit: 20, windowMs: 10 * 60_000 },
} as const;

export type RatePolicyName = keyof typeof ratePolicies;
type BucketMap = Map<string, number[]>;
const rateGlobal = globalThis as typeof globalThis & { __speedzoneRateBuckets?: BucketMap };
const buckets = (rateGlobal.__speedzoneRateBuckets ??= new Map());

export type RateLimitResult = { allowed: true; remaining: number } | { allowed: false; retryAfter: number };

export function checkRateLimit(policyName: RatePolicyName, key: string, now = Date.now()): RateLimitResult {
  const policy = ratePolicies[policyName];
  const bucketKey = `${policyName}:${key}`;
  const cutoff = now - policy.windowMs;
  const active = (buckets.get(bucketKey) ?? []).filter(
    (timestamp: number) => timestamp > cutoff,
  );
  if (active.length >= policy.limit) {
    const retryAfter = Math.max(1, Math.ceil(((active[0] ?? now) + policy.windowMs - now) / 1000));
    buckets.set(bucketKey, active);
    return { allowed: false, retryAfter };
  }
  active.push(now);
  buckets.set(bucketKey, active);
  return { allowed: true, remaining: policy.limit - active.length };
}

export async function progressiveFailureDelay(attempts: number): Promise<void> {
  const base = Math.min(2500, 250 * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * 251);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, base + jitter));
}

export function resetRateLimitsForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Rate limits can only be reset in tests");
  buckets.clear();
}
