// Applies the SEcure_Auth schema and reports who can reach the authentication
// record. Run it from a trusted workstation, or from CI with AUTH_DATABASE_URL
// supplied as a secret, before deploying.
//
//   npm run migrate:auth-db                              apply schema, sweep, report
//   npm run migrate:auth-db -- --check                   report only; no DDL, no deletes
//   npm run migrate:auth-db -- --grant-role <role_name>  also apply least-privilege grants

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

const expectedDatabase = process.env.AUTH_DATABASE_NAME ?? "SEcure_Auth";
const neonProjectId = "shy-sunset-14721124";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");

function grantRole() {
  const index = args.indexOf("--grant-role");
  if (index === -1) return undefined;
  const name = args[index + 1];
  // Validated here so it can be safely quoted into an identifier position,
  // which no query parameter can occupy.
  if (!name || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error("--grant-role requires a lowercase PostgreSQL role name");
  }
  return name;
}

function fromEnvFile(name) {
  for (const file of [".env.local", ".env"]) {
    let contents;
    try {
      contents = readFileSync(resolve(file), "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match?.[1] !== name) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      if (value) return value;
    }
  }
  return undefined;
}

function connectionString() {
  const raw =
    process.env.AUTH_DATABASE_URL?.trim() ||
    fromEnvFile("AUTH_DATABASE_URL") ||
    process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "Set AUTH_DATABASE_URL to the SEcure_Auth connection string " +
        `(Neon project ${neonProjectId}) in the environment or .env`,
    );
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("AUTH_DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== expectedDatabase) {
    throw new Error(
      `AUTH_DATABASE_URL points at "${database}" but authentication must use "${expectedDatabase}"`,
    );
  }
  return { raw, host: parsed.hostname, database };
}

/**
 * The HTTP driver sends one statement per request, so a SQL file is split on
 * statement boundaries and replayed inside a single transaction. Every statement
 * in db/ is idempotent, so re-running is safe.
 */
function statementsFrom(file, substitutions = {}) {
  const path = resolve("db", file);
  let source = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  for (const [token, value] of Object.entries(substitutions)) {
    source = source.replaceAll(token, value);
  }
  const statements = source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (!statements.length) throw new Error(`${path} contains no statements`);
  return statements;
}

async function apply(sql, label, statements) {
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`Applied ${statements.length} statements from ${label}`);
}

async function main() {
  const target = connectionString();
  const role = grantRole();
  const sql = neon(target.raw);

  const [identity] = await sql`SELECT current_database() AS database, current_user AS role`;
  if (identity.database !== expectedDatabase) {
    throw new Error(
      `Connected to "${identity.database}" but expected "${expectedDatabase}"; check the endpoint`,
    );
  }
  console.log(`Connected to ${identity.database} on ${target.host} as ${identity.role}`);

  if (checkOnly) {
    console.log("Running in --check mode: no schema, grant, or sweep changes will be made.");
  } else {
    await apply(sql, "db/001-auth-schema.sql", statementsFrom("001-auth-schema.sql"));
    if (role) {
      await apply(
        sql,
        `db/002-auth-role.sql (${role})`,
        statementsFrom("002-auth-role.sql", { ":app_role": `"${role}"` }),
      );
    }
  }

  const [record] = await sql`
    SELECT state ->> 'state'                                 AS lifecycle,
           revision::text                                    AS revision,
           jsonb_array_length(state -> 'passkeys')            AS passkeys,
           jsonb_array_length(state -> 'recoveryCodeHashes')  AS recovery_codes,
           updated_at
      FROM auth_state
     WHERE id = 1
  `;
  if (record) {
    console.log(
      `auth_state: ${record.lifecycle} at revision ${record.revision} ` +
        `(${record.passkeys} passkeys, ${record.recovery_codes} recovery codes, ` +
        `updated ${new Date(record.updated_at).toISOString()})`,
    );
  } else {
    console.log(
      "auth_state: empty. The first authenticated request seeds it from the legacy " +
        "private Blob object, the legacy Global Config mirror, or a fresh BOOTSTRAP_READY record.",
    );
  }

  if (!checkOnly) {
    const swept = await sql`DELETE FROM auth_consume_markers WHERE expires_at < now() RETURNING 1`;
    if (swept.length) console.log(`Swept ${swept.length} expired one-time markers`);
  }

  const [markers] = await sql`
    SELECT count(*)::int                                   AS total,
           count(*) FILTER (WHERE expires_at < now())::int  AS expired
      FROM auth_consume_markers
  `;
  console.log(`auth_consume_markers: ${markers.total} rows (${markers.expired} expired)`);

  // Who can reach the administrator's credentials. Anything beyond the owner
  // and the single runtime role is a finding, not a detail.
  const grants = await sql`
    SELECT grantee,
           string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('auth_state', 'auth_consume_markers')
     GROUP BY grantee
     ORDER BY grantee
  `;
  console.log("Access to the authentication tables:");
  for (const grant of grants) console.log(`  ${grant.grantee}: ${grant.privileges}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Authentication migration failed");
  process.exitCode = 1;
});
