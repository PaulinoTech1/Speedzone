import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";

const pw = process.env.SEED_ADMIN_PASSWORD;
const email = (process.env.ADMIN_ID || "").toLowerCase();
if (!pw) {
  console.error("NO_PW");
  process.exit(1);
}
if (!email) {
  console.error("NO_EMAIL");
  process.exit(1);
}
console.log("EMAIL=" + email);
console.log("PWLEN=" + pw.length);
console.log("UUID=" + randomUUID());
console.log("HASH=" + (await hashPassword(pw)));
