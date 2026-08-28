import "server-only";

import { createHmac } from "node:crypto";

import {
  administratorIdentifierSchema,
  canonicalizeAdministratorIdentifier,
} from "@/lib/domain/auth";

const truthy = new Set(["1", "true", "yes", "on"]);

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function base64urlSecret(name: string, required: boolean): string | undefined {
  const value = optional(name);
  if (!value) {
    if (required) throw new Error(`Missing required server environment variable: ${name}`);
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be canonical base64url without padding`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32 || decoded.toString("base64url") !== value) {
    throw new Error(`${name} must decode to at least 32 bytes in canonical base64url form`);
  }
  return value;
}

function sha256Digest(name: string, required: boolean): string | undefined {
  const value = optional(name)?.toLowerCase();
  if (!value) {
    if (required) throw new Error(`Missing required server environment variable: ${name}`);
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte SHA-256 digest encoded as lowercase hex`);
  }
  return value;
}

export function requiredEnv(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export function booleanEnv(name: string): boolean {
  return truthy.has((process.env[name] ?? "").trim().toLowerCase());
}

export function normalizeAdministrator(value: string): string {
  return canonicalizeAdministratorIdentifier(value);
}

export function adminConfig() {
  const identifier = administratorIdentifierSchema.safeParse(requiredEnv("ADMIN_ID"));
  if (!identifier.success) {
    throw new Error("ADMIN_ID must be a valid canonicalizable email address or username");
  }
  const passwordHash = requiredEnv("ADMIN_PASSWORD_HASH");
  if (!/^\$argon2id\$v=19\$/.test(passwordHash)) {
    throw new Error("ADMIN_PASSWORD_HASH must be an encoded Argon2id hash");
  }
  return {
    identifier: identifier.data,
    passwordHash,
    passwordPepper: base64urlSecret("ADMIN_PASSWORD_PEPPER", false),
    bootstrapTokenHash: sha256Digest("ADMIN_BOOTSTRAP_TOKEN_HASH", false),
    disabled: booleanEnv("ADMIN_DISABLED"),
  };
}

function derivedCookieSecret(master: string, purpose: string): string {
  return createHmac("sha256", Buffer.from(master, "base64url"))
    .update(`speedzone:${purpose}:v1`, "utf8")
    .digest("base64url");
}

export function tokenConfig() {
  const cookieSecret = base64urlSecret("AUTH_COOKIE_SECRET", false);
  const passwordPepper = base64urlSecret("ADMIN_PASSWORD_PEPPER", false);
  if (process.env.NODE_ENV === "production" && !cookieSecret) {
    throw new Error("Missing required server environment variable: AUTH_COOKIE_SECRET");
  }
  if (cookieSecret && passwordPepper && cookieSecret === passwordPepper) {
    throw new Error("ADMIN_PASSWORD_PEPPER must not reuse AUTH_COOKIE_SECRET");
  }
  const config = cookieSecret
    ? {
        encryptionKey: derivedCookieSecret(cookieSecret, "cookie-encryption"),
        signingKey: derivedCookieSecret(cookieSecret, "cookie-signing"),
        hashKey: derivedCookieSecret(cookieSecret, "security-hashing"),
        recoveryPepper: derivedCookieSecret(cookieSecret, "recovery-codes"),
      }
    : {
        // Legacy development/test compatibility. Production provisioning must
        // use the single AUTH_COOKIE_SECRET requested by the setup workflow.
        encryptionKey: base64urlSecret("AUTH_ENCRYPTION_KEY", true)!,
        signingKey: base64urlSecret("AUTH_SIGNING_KEY", true)!,
        hashKey: base64urlSecret("AUTH_HASH_KEY", true)!,
        recoveryPepper: base64urlSecret("RECOVERY_CODE_PEPPER", true)!,
      };
  const configuredSecrets = [
    ...Object.entries(config),
    ["passwordPepper", passwordPepper],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const seen = new Map<string, string>();
  for (const [name, value] of configuredSecrets) {
    const previous = seen.get(value);
    if (previous) throw new Error(`${name} must not reuse ${previous}`);
    seen.set(value, name);
  }
  return config;
}

export function webAuthnConfig() {
  const expectedOrigin = optional("WEBAUTHN_EXPECTED_ORIGIN");
  const configuredOrigins = optional("WEBAUTHN_ALLOWED_ORIGINS")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isDevelopment = process.env.NODE_ENV !== "production";
  const origins = expectedOrigin
    ? [expectedOrigin]
    : configuredOrigins?.length
    ? configuredOrigins
    : isDevelopment
      ? ["http://localhost:4173", "http://127.0.0.1:4173"]
      : [];

  if (!origins.length) throw new Error("WEBAUTHN_ALLOWED_ORIGINS must list explicit origins");
  if (process.env.NODE_ENV === "production" && !expectedOrigin) {
    throw new Error("WEBAUTHN_EXPECTED_ORIGIN must be explicitly configured in production");
  }

  const rpID = optional("WEBAUTHN_RP_ID") ?? (isDevelopment ? "localhost" : requiredEnv("WEBAUTHN_RP_ID"));
  const canonicalRpIdPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!canonicalRpIdPattern.test(rpID)) {
    throw new Error("WEBAUTHN_RP_ID must be a canonical lowercase ASCII hostname");
  }
  if (process.env.NODE_ENV === "production" && !rpID.includes(".")) {
    throw new Error("Production WEBAUTHN_RP_ID must contain at least two labels");
  }
  if (expectedOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(expectedOrigin);
    } catch {
      throw new Error("WEBAUTHN_EXPECTED_ORIGIN must be a canonical origin");
    }
    if (
      parsed.origin !== expectedOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.hostname !== rpID && !parsed.hostname.endsWith(`.${rpID}`)) ||
      (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    ) {
      throw new Error("WEBAUTHN_EXPECTED_ORIGIN and WEBAUTHN_RP_ID are inconsistent");
    }
  }

  return {
    rpID,
    rpName: optional("WEBAUTHN_RP_NAME") ?? "SpeedZone Motorsports",
    origins,
    expectedOrigin,
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * The setup page uses this before rendering. It deliberately trusts only
 * explicit environment configuration, never Host or forwarded headers.
 */
export function bootstrapEnrollmentRuntimePermitted(): boolean {
  try {
    // Validate every core credential/session input before exposing setup.
    adminConfig();
    tokenConfig();
    const config = webAuthnConfig();
    if (!config.expectedOrigin) return false;
    const origin = new URL(config.expectedOrigin);
    if (
      origin.origin !== config.expectedOrigin ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return false;
    }
    const rpMatchesOrigin =
      origin.hostname === config.rpID || origin.hostname.endsWith(`.${config.rpID}`);
    if (!rpMatchesOrigin) return false;

    if (process.env.NODE_ENV === "production") {
      return origin.protocol === "https:" && process.env.VERCEL_ENV === "production";
    }
    return (
      !process.env.VERCEL &&
      !process.env.VERCEL_ENV &&
      process.env.ALLOW_INSECURE_WEBAUTHN_TEST_ORIGIN === "true" &&
      origin.protocol === "http:" &&
      isLoopbackHostname(origin.hostname) &&
      config.rpID === "localhost"
    );
  } catch {
    return false;
  }
}

export type GlobalConfigKind = "auth" | "inventory";

/**
 * Read-only migration sources. Authentication now lives in SEcure_Auth and
 * inventory in private Blob, so the application never writes Global Config and
 * needs no management API token for it.
 */
export function globalConfigSettings(kind: GlobalConfigKind) {
  const prefix = kind === "auth" ? "AUTH" : "INVENTORY";
  return {
    connectionString: optional(`${prefix}_GLOBAL_CONFIG`),
  };
}

/**
 * Server-side authentication lives in the dedicated `SEcure_Auth` Neon database
 * (project `shy-sunset-14721124`), never in the inventory or photo stores. The
 * database name is verified here so a copy-pasted connection string cannot
 * silently point administrator credentials at a different database.
 */
export const authDatabaseDefaults = {
  name: "SEcure_Auth",
  projectId: "shy-sunset-14721124",
} as const;

export type AuthDatabaseSettings = Readonly<{
  connectionString: string;
  host: string;
  database: string;
}>;

export function authDatabaseSettings(): AuthDatabaseSettings | undefined {
  const raw = optional("AUTH_DATABASE_URL") ?? optional("DATABASE_URL");
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("AUTH_DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("AUTH_DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }
  if (!parsed.hostname) {
    throw new Error("AUTH_DATABASE_URL must include a database host");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("AUTH_DATABASE_URL must name a database");
  }
  const expected = optional("AUTH_DATABASE_NAME") ?? authDatabaseDefaults.name;
  if (database !== expected) {
    throw new Error(
      `AUTH_DATABASE_URL points at "${database}" but authentication must use "${expected}"`,
    );
  }
  if (process.env.NODE_ENV === "production" && parsed.searchParams.get("sslmode") !== "require") {
    throw new Error("AUTH_DATABASE_URL must request sslmode=require in production");
  }
  return { connectionString: raw, host: parsed.hostname, database };
}

// Shared by every public lead form (test drive, sell/trade-in) that emails a
// notification through Resend rather than writing to inventory storage.
export function leadNotificationConfig() {
  return {
    resendApiKey: optional("RESEND_API_KEY"),
    fromEmail: optional("RESEND_FROM_EMAIL"),
    notifyEmail: optional("LEAD_NOTIFICATION_EMAIL") ?? "smpaulino.business@gmail.com",
  };
}

export function localStatePath(): string {
  return optional("LOCAL_STATE_PATH") ?? ".data/state.json";
}

export function localSecurityPath(): string {
  return optional("LOCAL_SECURITY_PATH") ?? ".data/security-consume";
}

export function privateBlobToken(): string | undefined {
  return optional("BLOB_PRIVATE_READ_WRITE_TOKEN");
}

export function photoBlobToken(): string | undefined {
  return optional("BLOB_PHOTO_READ_WRITE_TOKEN");
}

export type InventoryBlobCredentials = Readonly<{
  token?: string;
  oidcToken?: string;
  storeId?: string;
}>;

/**
 * The inventory store can use a dedicated Vercel connection prefix
 * (`BLOB_INVENTORY`) or Vercel Blob's default `BLOB` prefix. Prefer OIDC
 * whenever a store ID and runtime OIDC token are both available; the static
 * read-write token remains supported for existing Blob connections.
 */
export function inventoryBlobCredentials(): InventoryBlobCredentials | undefined {
  const oidcToken = optional("VERCEL_OIDC_TOKEN");
  const dedicatedStoreId = optional("BLOB_INVENTORY_STORE_ID");
  const dedicatedToken = optional("BLOB_INVENTORY_READ_WRITE_TOKEN");

  if (dedicatedStoreId && oidcToken) return { storeId: dedicatedStoreId, oidcToken };
  if (dedicatedToken) return { token: dedicatedToken };
  if (dedicatedStoreId) return { storeId: dedicatedStoreId };

  const storeId = optional("BLOB_STORE_ID");
  const token = optional("BLOB_READ_WRITE_TOKEN");
  if (storeId && oidcToken) return { storeId, oidcToken };
  if (token) return { token };
  if (storeId) return { storeId };
  return undefined;
}

export function encryptedDraftsEnabled(): boolean {
  return booleanEnv("ENABLE_ENCRYPTED_LOCAL_DRAFTS");
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(optional(name) ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function imageLimits() {
  return {
    maximumDimension: boundedInteger("MAX_IMAGE_DIMENSION", 1600, 320, 4096),
    maximumBytes: boundedInteger("MAX_IMAGE_BYTES", 4 * 1024 * 1024, 64 * 1024, 8 * 1024 * 1024),
  };
}
