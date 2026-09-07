import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import pg from "pg";

import { readHidden } from "./password-input.mjs";

/**
 * Seed (or repair) the Better Auth administrator that the shipping login form
 * and the forgot/reset-password flow actually authenticate against.
 *
 * `provision-admin.mjs` only emits environment variables for the custom
 * passkey/argon2 system; it never creates the Neon `user`/`account` rows that
 * Better Auth reads. Without those rows `signIn.email` always fails and
 * `requestPasswordReset` silently no-ops for an unknown address, which looks
 * exactly like "recovery does not reset the password". This script closes that
 * gap and is safe to re-run: it upserts the user and its credential account.
 *
 * The password is hashed with Better Auth's own `hashPassword`, so the stored
 * value verifies with the same routine the login endpoint uses.
 *
 * Usage:
 *   node scripts/seed-auth-user.mjs --email=admin@example.com
 *   SEED_ADMIN_EMAIL=admin@example.com node scripts/seed-auth-user.mjs
 * The email defaults to ADMIN_ID when set. The password is read interactively;
 * for non-interactive use, pipe it on stdin or set SEED_ADMIN_PASSWORD.
 */

const passwordLimits = { minimumCodePoints: 16, maximumCodePoints: 128, maximumUtf8Bytes: 512 };
const emailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function canonicalEmail(value) {
  return value.trim().normalize("NFKC").toLowerCase();
}

function resolveEmail() {
  const raw = argValue("email") ?? process.env.SEED_ADMIN_EMAIL ?? process.env.ADMIN_ID;
  if (!raw) {
    throw new Error(
      "Administrator email is required. Pass --email=<address>, or set SEED_ADMIN_EMAIL or ADMIN_ID.",
    );
  }
  const email = canonicalEmail(raw);
  if (!emailPattern.test(email)) {
    throw new Error(`"${raw}" is not a valid administrator email address`);
  }
  return email;
}

function validatePassword(password) {
  const codePoints = [...password].length;
  const bytes = Buffer.byteLength(password, "utf8");
  if (
    codePoints < passwordLimits.minimumCodePoints ||
    codePoints > passwordLimits.maximumCodePoints ||
    bytes > passwordLimits.maximumUtf8Bytes
  ) {
    throw new Error(
      `Password must contain ${passwordLimits.minimumCodePoints}-${passwordLimits.maximumCodePoints} Unicode code points and at most ${passwordLimits.maximumUtf8Bytes} UTF-8 bytes`,
    );
  }
}

async function resolvePassword() {
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  const password = await readHidden("Administrator password: ");
  if (!process.stdin.isTTY) return password;
  const confirmation = await readHidden("Confirm administrator password: ");
  if (password !== confirmation) throw new Error("Password entries do not match");
  return password;
}

function connectionString() {
  const url = process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set AUTH_DATABASE_URL (or DATABASE_URL) to the SEcure_Auth connection string");
  }
  return url;
}

function newId() {
  return randomBytes(16).toString("hex");
}

async function seed() {
  const email = resolveEmail();
  const password = await resolvePassword();
  validatePassword(password);
  const passwordHash = await hashPassword(password);

  const url = connectionString();
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("BEGIN");

    const existingUser = await client.query('SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1', [
      email,
    ]);
    let userId = existingUser.rows[0]?.id;
    let createdUser = false;
    if (userId) {
      await client.query(
        'UPDATE "user" SET "emailVerified" = true, "updatedAt" = now() WHERE id = $1',
        [userId],
      );
    } else {
      userId = newId();
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())',
        [userId, "Administrator", email],
      );
      createdUser = true;
    }

    const existingAccount = await client.query(
      "SELECT id FROM account WHERE \"userId\" = $1 AND \"providerId\" = 'credential' LIMIT 1",
      [userId],
    );
    if (existingAccount.rows[0]?.id) {
      await client.query(
        'UPDATE account SET password = $1, "updatedAt" = now() WHERE id = $2',
        [passwordHash, existingAccount.rows[0].id],
      );
    } else {
      await client.query(
        'INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, now(), now())',
        [newId(), userId, "credential", userId, passwordHash],
      );
    }

    await client.query("COMMIT");
    process.stdout.write(
      `${createdUser ? "Created" : "Updated"} administrator ${email}. Password set; sign in at /admin/login.\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
