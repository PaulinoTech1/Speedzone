import { randomBytes } from "node:crypto";

import { argon2id, hash } from "argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  findRecoveryCodeHash,
  generateRecoveryCodes,
} from "@/lib/server/auth/recovery";
import {
  parseArgon2Parameters,
  verifyAdministrator,
} from "@/lib/server/auth/password";
import { adminConfig, tokenConfig } from "@/lib/server/env";

const originalHash = process.env.ADMIN_PASSWORD_HASH;
const originalPepper = process.env.ADMIN_PASSWORD_PEPPER;

describe("password verification", () => {
  beforeAll(async () => {
    const pepper = randomBytes(32);
    process.env.ADMIN_PASSWORD_PEPPER = pepper.toString("base64url");
    process.env.ADMIN_PASSWORD_HASH = await hash("correct horse battery staple", {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
      secret: pepper,
    });
  });

  afterEach(() => {
    process.env.ADMIN_DISABLED = "false";
  });

  it("verifies the real Argon2id hash and separate pepper", async () => {
    expect(await verifyAdministrator(" Administrator ", "correct horse battery staple")).toBe(true);
    expect(await verifyAdministrator("administrator", "wrong password")).toBe(false);
    expect(await verifyAdministrator("unknown", "correct horse battery staple")).toBe(false);
  });

  it("fails a disabled account and rejects parameters below the OWASP floor", async () => {
    process.env.ADMIN_DISABLED = "true";
    expect(await verifyAdministrator("administrator", "correct horse battery staple")).toBe(false);
    expect(() =>
      parseArgon2Parameters("$argon2id$v=19$m=8192,t=1,p=1$abc$def"),
    ).toThrow(/below/);
  });

  afterAll(() => {
    process.env.ADMIN_PASSWORD_HASH = originalHash;
    if (originalPepper === undefined) delete process.env.ADMIN_PASSWORD_PEPPER;
    else process.env.ADMIN_PASSWORD_PEPPER = originalPepper;
  });
});

describe("recovery codes", () => {
  it("creates ten one-time-code candidates with at least 128 bits of entropy", () => {
    const generated = generateRecoveryCodes();
    expect(generated.codes).toHaveLength(10);
    expect(new Set(generated.codes).size).toBe(10);
    for (const code of generated.codes) {
      expect(code.replaceAll("-", "")).toHaveLength(26);
    }
    const found = findRecoveryCodeHash(generated.codes[0] ?? "", generated.hashes);
    expect(found).toBe(generated.hashes[0]);
    expect(findRecoveryCodeHash("WRONG-CODE", generated.hashes)).toBeNull();
  });
});

describe("secret configuration", () => {
  it("rejects weak or reused server secrets", () => {
    const bootstrapHash = process.env.ADMIN_BOOTSTRAP_TOKEN_HASH;
    const cookieSecret = process.env.AUTH_COOKIE_SECRET;
    const hashKey = process.env.AUTH_HASH_KEY;
    try {
      process.env.ADMIN_BOOTSTRAP_TOKEN_HASH = "weak";
      expect(() => adminConfig()).toThrow(/SHA-256/);

      delete process.env.ADMIN_BOOTSTRAP_TOKEN_HASH;
      delete process.env.AUTH_COOKIE_SECRET;
      process.env.AUTH_HASH_KEY = process.env.AUTH_SIGNING_KEY;
      expect(() => tokenConfig()).toThrow(/must not reuse/);
    } finally {
      if (bootstrapHash === undefined) delete process.env.ADMIN_BOOTSTRAP_TOKEN_HASH;
      else process.env.ADMIN_BOOTSTRAP_TOKEN_HASH = bootstrapHash;
      if (cookieSecret === undefined) delete process.env.AUTH_COOKIE_SECRET;
      else process.env.AUTH_COOKIE_SECRET = cookieSecret;
      if (hashKey === undefined) delete process.env.AUTH_HASH_KEY;
      else process.env.AUTH_HASH_KEY = hashKey;
    }
  });
});
