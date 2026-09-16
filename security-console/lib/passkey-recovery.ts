import { createHash, timingSafeEqual } from "node:crypto";
import { getSecurityRedis } from "./redis";

export function recoveryGrant() {
  try {
    const value: unknown = JSON.parse(process.env.SECURITY_PASSKEY_RECOVERY || "null");
    if (!value || typeof value !== "object") return null;
    const { sha256, expiresAt } = value as Record<string, unknown>;
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)
      || typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)
      || expiresAt <= Date.now() || expiresAt > Date.now() + 86_400_000) return null;
    return { sha256, expiresAt };
  } catch { return null; }
}

export function recoveryUsedKey(hash: string) {
  return `speedzone:security-console:passkey-recovery:used:${hash}`;
}

export function recoveryCodeMatches(code: unknown, hash: string) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) return false;
  return timingSafeEqual(createHash("sha256").update(code).digest(), Buffer.from(hash, "hex"));
}

export async function passkeyRecoveryAvailable() {
  const grant = recoveryGrant();
  const redis = getSecurityRedis();
  if (!grant || !redis) return false;
  try { return await redis.get(recoveryUsedKey(grant.sha256)) === null; }
  catch { return false; }
}
