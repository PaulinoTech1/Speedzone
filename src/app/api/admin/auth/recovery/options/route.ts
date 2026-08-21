import { NextRequest } from "next/server";
import { z } from "zod";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  labelSchema,
  readRecoveryProof,
} from "@/app/api/admin/auth/_shared";
import { registrationOptions, setCeremony } from "@/lib/server/auth/webauthn";
import { assertCsrf } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import { assertAllowedOrigin, noStoreJson, parseJsonBody } from "@/lib/server/request";
import { enforceRateLimit, routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ label: labelSchema }).strict();

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    enforceRateLimit(request, "recovery", "administrator-recovery");
    const state = await readAuthState();
    const proof = readRecoveryProof(request, state);
    if (!proof || adminConfig().disabled || state.state !== "RECOVERY") {
      throw new AuthenticationFlowError();
    }
    assertCsrf(request, proof.sid);
    const body = await parseJsonBody(request, bodySchema, 4_096);
    const { options, ceremony } = await registrationOptions(
      state,
      "recovery",
      proof.sid,
      body.label,
      proof.recoveryCodeHash,
    );
    const response = noStoreJson({ ok: true, options });
    setCeremony(response, ceremony);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.recovery");
    }
    return routeError(error);
  }
}
