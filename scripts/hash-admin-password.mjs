import { randomBytes } from "node:crypto";

import { argon2id, hash } from "argon2";

import { readHidden } from "./password-input.mjs";

const password = await readHidden("Administrator password: ");
const passwordCodePoints = [...password].length;
const passwordBytes = Buffer.byteLength(password, "utf8");
if (passwordCodePoints < 16) {
  throw new Error("Administrator password must contain at least 16 Unicode code points");
}
if (passwordCodePoints > 128) {
  throw new Error("Administrator password exceeds the 128-code-point limit");
}
if (passwordBytes > 512) {
  throw new Error("Administrator password exceeds the 512-byte UTF-8 limit");
}
const pepperText = process.env.ADMIN_PASSWORD_PEPPER?.trim();
const pepper = pepperText ? Buffer.from(pepperText, "base64url") : undefined;
if (
  pepperText &&
  (!/^[A-Za-z0-9_-]+$/.test(pepperText) ||
    !pepper ||
    pepper.length < 32 ||
    pepper.toString("base64url") !== pepperText)
) {
  throw new Error("ADMIN_PASSWORD_PEPPER must decode to at least 32 bytes in canonical base64url form");
}

const encoded = await hash(password, {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  salt: randomBytes(16),
  secret: pepper,
});
process.stdout.write(`${encoded}\n`);
