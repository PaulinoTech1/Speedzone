import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

import { argon2id, hash } from "argon2";

import { readHidden } from "./password-input.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Administrator provisioning requires an interactive terminal");
}

async function readVisible(prompt) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}

function canonicalAdministratorId(value) {
  return value.trim().normalize("NFKC").toLowerCase();
}

function validateAdministratorId(value) {
  const canonical = canonicalAdministratorId(value);
  const length = [...canonical].length;
  const username = /^[a-z0-9._-]+$/.test(canonical);
  const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(canonical);
  if (length < 3 || length > 254 || (canonical.includes("@") ? !email : !username)) {
    throw new Error("Administrator ID must be a valid username or email address");
  }
  return canonical;
}

function validatePassword(password) {
  const codePoints = [...password].length;
  const bytes = Buffer.byteLength(password, "utf8");
  if (codePoints < 16 || codePoints > 128 || bytes > 512) {
    throw new Error("Password must contain 16-128 Unicode code points and at most 512 UTF-8 bytes");
  }
}

function validateWebAuthn(rpID, expectedOrigin) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rpID)) {
    throw new Error("RP ID must be a lowercase production hostname with at least two labels");
  }
  const parsed = new URL(expectedOrigin);
  if (
    parsed.origin !== expectedOrigin ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.hostname !== rpID && !parsed.hostname.endsWith(`.${rpID}`))
  ) {
    throw new Error("Expected origin must be a canonical HTTPS origin within the RP ID");
  }
}

const administratorId = validateAdministratorId(await readVisible("Administrator ID: "));
const password = await readHidden("Initial administrator password: ");
const passwordConfirmation = await readHidden("Confirm administrator password: ");
if (password !== passwordConfirmation) throw new Error("Password entries do not match");
validatePassword(password);

const rpID = (await readVisible("Production WebAuthn RP ID (for example, example.com): ")).trim();
const expectedOrigin = (await readVisible("Final production HTTPS origin: ")).trim();
validateWebAuthn(rpID, expectedOrigin);

const passwordHash = await hash(password, {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  salt: randomBytes(16),
});
const bootstrapToken = randomBytes(32).toString("base64url");
const bootstrapTokenHash = createHash("sha256").update(bootstrapToken, "utf8").digest("hex");
const cookieSecret = randomBytes(32).toString("base64url");

const values = {
  ADMIN_ID: administratorId,
  ADMIN_PASSWORD_HASH: passwordHash,
  ADMIN_BOOTSTRAP_TOKEN_HASH: bootstrapTokenHash,
  AUTH_COOKIE_SECRET: cookieSecret,
  WEBAUTHN_RP_ID: rpID,
  WEBAUTHN_EXPECTED_ORIGIN: expectedOrigin,
};

process.stdout.write("\nEnvironment variable names:\n");
for (const name of Object.keys(values)) process.stdout.write(`${name}\n`);
process.stdout.write("\nEnvironment values (copy to Vercel; do not save in this repository):\n");
for (const [name, value] of Object.entries(values)) process.stdout.write(`${name}=${value}\n`);
process.stdout.write(`\nOne-time bootstrap token (displayed once): ${bootstrapToken}\n`);
process.stdout.write("Store the token temporarily in a password manager or offline record, then remove it after activation.\n");
