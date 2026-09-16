// Run locally on a trusted operator machine. Never commit the output.
import { createHash, randomBytes } from "node:crypto";

const code = randomBytes(32).toString("base64url");
const grant = {
  sha256: createHash("sha256").update(code).digest("hex"),
  expiresAt: Date.now() + 3_600_000,
};

console.log("Recovery code:", code);
console.log("SECURITY_PASSKEY_RECOVERY=" + JSON.stringify(grant));
