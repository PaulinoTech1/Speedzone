import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { authDatabaseSettings } from "@/lib/server/env";
import { StateConfigurationError } from "@/lib/server/storage/errors";

export type AuthSql = NeonQueryFunction<false, false>;

type CachedClient = { connectionString: string; sql: AuthSql };
const clientGlobal = globalThis as typeof globalThis & {
  __speedzoneAuthDatabase?: CachedClient;
};

/**
 * A malformed or misdirected connection string is an operator problem, not a
 * runtime fault, so it fails closed the same way a missing one does.
 */
function settings() {
  try {
    return authDatabaseSettings();
  } catch (error) {
    throw new StateConfigurationError(
      error instanceof Error ? error.message : "Authentication database is not configured",
    );
  }
}

/** True when this deployment has an authentication database connection configured. */
export function authDatabaseConfigured(): boolean {
  return Boolean(settings());
}

/**
 * The `SEcure_Auth` Neon database is the authoritative home of every server-side
 * authentication record. The HTTP driver is stateless, so one client is reused
 * per connection string and a rotated credential takes effect without a rebuild.
 */
export function authDatabase(): AuthSql {
  const target = settings();
  if (!target) {
    throw new StateConfigurationError("Authentication database is not configured");
  }
  const cached = clientGlobal.__speedzoneAuthDatabase;
  if (cached?.connectionString === target.connectionString) return cached.sql;
  const sql = neon(target.connectionString);
  clientGlobal.__speedzoneAuthDatabase = { connectionString: target.connectionString, sql };
  return sql;
}

const undefinedTable = "42P01";
const insufficientPrivilege = "42501";
const invalidPassword = "28P01";
const invalidAuthorization = "28000";
const undefinedDatabase = "3D000";

/**
 * Distinguish an operator-fixable misconfiguration, which fails closed as a 503,
 * from a transient database outage, which must keep surfacing as an error rather
 * than being reported as "not configured".
 */
export function translateAuthDatabaseError(error: unknown): unknown {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return error;
  if (code === undefinedTable) {
    return new StateConfigurationError(
      "Authentication schema is missing; apply the SEcure_Auth migration",
    );
  }
  if (
    code === insufficientPrivilege ||
    code === invalidPassword ||
    code === invalidAuthorization ||
    code === undefinedDatabase
  ) {
    return new StateConfigurationError("Authentication database credentials are not usable");
  }
  return error;
}
