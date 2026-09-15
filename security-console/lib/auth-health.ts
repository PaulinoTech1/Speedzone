import { getSecurityRedis, securityRedisConfiguration } from "./redis";

const prefix = "speedzone:security-console:";
const presence = (value: unknown) => value === null ? "MISSING" : "PRESENT";

// Read-only, explicit allowlist. Never return Redis values or exception messages.
export async function authenticationHealth() {
  const configuration = securityRedisConfiguration();
  const unavailable = { configuration: configuration.status, source: configuration.source, redis: "UNAVAILABLE" as const };
  try {
    const redis = getSecurityRedis();
    if (!redis) return unavailable;
    const [credential, epoch, passkeys, legacy, generation] = await Promise.all([
      redis.get(`${prefix}credential:v1`), redis.get(`${prefix}credential-epoch:v1`),
      redis.get(`${prefix}passkeys:v1`), redis.get(`${prefix}passkeys`), redis.get(`${prefix}session-generation:v1`),
    ]);
    const numericEpoch = Number(epoch);
    const validEpoch = Number.isSafeInteger(numericEpoch) && numericEpoch > 0;
    return { ...unavailable, redis: "CONNECTED" as const, credential: presence(credential),
      credentialEpoch: presence(epoch), currentEpoch: validEpoch ? numericEpoch : null,
      passkeyStore: presence(passkeys), activePasskeys: Array.isArray(passkeys) && validEpoch
        ? passkeys.filter(item => item && item.credentialEpoch === numericEpoch).length : null,
      legacyPasskeyStore: presence(legacy), legacyPasskeys: Array.isArray(legacy) ? legacy.length : null,
      sessionGeneration: presence(generation) };
  } catch { return unavailable; }
}

export async function logAuthenticationFailure(reason: "storage_unavailable" | "assertion_denied" | "session_upgrade_denied" | "no_active_passkey") {
  console.warn("Security Console authentication failure", { reason, ...await authenticationHealth() });
}
