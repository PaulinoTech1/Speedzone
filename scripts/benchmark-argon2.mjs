import { randomBytes } from "node:crypto";

import { argon2id, hash } from "argon2";

const samples = Math.max(1, Math.min(10, Number(process.argv[2] ?? 5)));
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
const times = [];

for (let sample = 0; sample < samples; sample += 1) {
  const started = performance.now();
  await hash(randomBytes(32), {
    type: argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    salt: randomBytes(16),
    secret: pepper,
  });
  times.push(Number((performance.now() - started).toFixed(1)));
}

const sorted = [...times].sort((left, right) => left - right);
const median = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
process.stdout.write(
  `${JSON.stringify({ runtime: process.version, parameters: { memoryKiB: 65536, iterations: 3, parallelism: 1 }, samplesMs: times, medianMs: median, p95Ms: p95 }, null, 2)}\n`,
);
