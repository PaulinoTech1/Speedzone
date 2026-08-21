import "server-only";

import { verify } from "argon2";

import {
  administratorIdentifierSchema,
  administratorPasswordSchema,
} from "@/lib/domain/auth";
import { constantTimeTextEqual } from "@/lib/server/crypto";
import { adminConfig } from "@/lib/server/env";

const minimumArgon2 = { memory: 19_456, iterations: 2, parallelism: 1 };

export function parseArgon2Parameters(encodedHash: string) {
  const match = encodedHash.match(/^\$argon2id\$v=\d+\$([^$]+)\$/);
  if (!match) throw new Error("ADMIN_PASSWORD_HASH must be an encoded Argon2id hash");
  const encodedParameters = Object.fromEntries(
    (match[1] ?? "").split(",").map((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0
        ? [entry.slice(0, separator), entry.slice(separator + 1)]
        : [entry, ""];
    }),
  );
  const parameters = {
    memory: Number(encodedParameters.m),
    iterations: Number(encodedParameters.t),
    parallelism: Number(encodedParameters.p),
  };
  if (
    !Number.isInteger(parameters.memory) ||
    !Number.isInteger(parameters.iterations) ||
    !Number.isInteger(parameters.parallelism) ||
    parameters.memory < minimumArgon2.memory ||
    parameters.iterations < minimumArgon2.iterations ||
    parameters.parallelism < minimumArgon2.parallelism
  ) {
    throw new Error("ADMIN_PASSWORD_HASH is below the OWASP Argon2id minimum");
  }
  return parameters;
}

export async function verifyAdministrator(identifier: string, password: string): Promise<boolean> {
  const passwordInput = administratorPasswordSchema.safeParse(password);
  if (!passwordInput.success) return false;
  const identifierInput = administratorIdentifierSchema.safeParse(identifier);
  const config = adminConfig();
  parseArgon2Parameters(config.passwordHash);
  let passwordValid = false;
  try {
    passwordValid = await verify(config.passwordHash, passwordInput.data, {
      secret: config.passwordPepper ? Buffer.from(config.passwordPepper, "base64url") : undefined,
    });
  } catch {
    passwordValid = false;
  }
  const identifierValid =
    identifierInput.success && constantTimeTextEqual(identifierInput.data, config.identifier);
  return passwordValid && identifierValid && !config.disabled;
}
