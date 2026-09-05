import { randomBytes } from "node:crypto";

import { argon2id, hash } from "argon2";
import { NextRequest } from "next/server";
import { z } from "zod";

import {
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import { parseArgon2Parameters } from "@/lib/server/auth/password";
import { adminConfig, booleanEnv } from "@/lib/server/env";
import { noStoreJson, parseJsonBody, RequestValidationError } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ samples: z.number().int().min(1).max(5).default(3) }).strict();

export async function POST(request: NextRequest) {
  try {
    const { claims } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    requireFreshStepUp(request, claims);
    await enforceRateLimit(request, "benchmark", claims.administrator);
    if (!booleanEnv("ENABLE_ARGON2_BENCHMARK")) {
      throw new RequestValidationError("Benchmark endpoint is disabled", 404, "NOT_FOUND");
    }
    const { samples } = await parseJsonBody(request, bodySchema, 1_024);
    const config = adminConfig();
    const parameters = parseArgon2Parameters(config.passwordHash);
    const durations: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const started = performance.now();
      await hash(randomBytes(32), {
        type: argon2id,
        memoryCost: parameters.memory,
        timeCost: parameters.iterations,
        parallelism: parameters.parallelism,
        hashLength: 32,
        salt: randomBytes(16),
        secret: config.passwordPepper
          ? Buffer.from(config.passwordPepper, "base64url")
          : undefined,
      });
      durations.push(Number((performance.now() - started).toFixed(1)));
    }
    const sorted = [...durations].sort((left, right) => left - right);
    const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return noStoreJson({
      ok: true,
      runtime: `node ${process.versions.node}`,
      parameters,
      samplesMs: durations,
      medianMs,
      targetMs: { minimum: 250, maximum: 500 },
    });
  } catch (error) {
    return routeError(error);
  }
}
