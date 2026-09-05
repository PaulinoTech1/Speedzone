import "server-only";

import { createHash } from "node:crypto";
import { authDatabase, authDatabaseConfigured, translateAuthDatabaseError } from "@/lib/server/storage/neon";
import { StateConfigurationError } from "@/lib/server/storage/errors";

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
  recallCheck: { limit: 20, windowMs: 10 * 60_000 },
} as const;

export type RatePolicyName = keyof typeof ratePolicies;
type Bucket = { count: number; expiresAt: number };
const rateGlobal = globalThis as typeof globalThis & { __speedzoneRateBucketsV2?: Map<string, Bucket> };
const buckets = (rateGlobal.__speedzoneRateBucketsV2 ??= new Map());
const maximumLocalBuckets = 10_000;

export type RateLimitResult = { allowed: true; remaining: number } | { allowed: false; retryAfter: number };

export async function checkRateLimit(policyName: RatePolicyName, key: string, now = Date.now()): Promise<RateLimitResult> {
  const policy = ratePolicies[policyName];
  const bucketKey = createHash("sha256").update(`${policyName}:${key}`).digest("hex");
  if (authDatabaseConfigured()) {
    const sql = authDatabase();
    try {
      // One atomic upsert serializes competing workers. The database clock is
      // authoritative; rejected attempts never extend the fixed window.
      const rows = await sql`
        WITH attempt AS (
          INSERT INTO security_rate_buckets AS b (bucket_key, attempts, expires_at)
          VALUES (${bucketKey}, 1, now() + ${policy.windowMs} * interval '1 millisecond')
          ON CONFLICT (bucket_key) DO UPDATE SET
            attempts = CASE WHEN b.expires_at <= now() THEN 1 ELSE LEAST(b.attempts + 1, ${policy.limit + 1}) END,
            expires_at = CASE WHEN b.expires_at <= now() THEN now() + ${policy.windowMs} * interval '1 millisecond' ELSE b.expires_at END
          RETURNING bucket_key, attempts, GREATEST(1, ceil(extract(epoch FROM (expires_at - now()))))::int AS retry_after
        ), expired AS (
          SELECT bucket_key FROM security_rate_buckets
          WHERE expires_at <= now() AND bucket_key <> (SELECT bucket_key FROM attempt)
          ORDER BY expires_at LIMIT 64 FOR UPDATE SKIP LOCKED
        ), swept AS (
          DELETE FROM security_rate_buckets WHERE bucket_key IN (SELECT bucket_key FROM expired)
        )
        SELECT attempts, retry_after FROM attempt
      `;
      const row = rows[0];
      if (!row || !Number.isInteger(row.attempts) || row.attempts < 1
        || !Number.isInteger(row.retry_after) || row.retry_after < 1) {
        throw new Error("Invalid rate-limit storage response");
      }
      return row.attempts <= policy.limit
        ? { allowed: true, remaining: policy.limit - row.attempts }
        : { allowed: false, retryAfter: row.retry_after };
    } catch (error) {
      throw translateAuthDatabaseError(error);
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new StateConfigurationError("Shared rate-limit storage is not configured");
  }
  // Local development/tests only. Never evict a live bucket to admit a new key.
  for (const [candidate, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(candidate);
  }
  const previous = buckets.get(bucketKey);
  if (!previous && buckets.size >= maximumLocalBuckets) return { allowed: false, retryAfter: 60 };
  const bucket = previous ?? { count: 0, expiresAt: now + policy.windowMs };
  bucket.count = Math.min(bucket.count + 1, policy.limit + 1);
  buckets.set(bucketKey, bucket);
  return bucket.count <= policy.limit
    ? { allowed: true, remaining: policy.limit - bucket.count }
    : { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
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
