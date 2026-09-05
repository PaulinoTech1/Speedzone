import { NextRequest } from "next/server";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  clearCeremony,
  readRecoveryProof,
  registrationBodySchema,
  registrationResponse,
  setPendingRecovery,
} from "@/app/api/admin/auth/_shared";
import { burnCeremony, readCeremony, verifyRegistration } from "@/lib/server/auth/webauthn";
import { assertCsrf } from "@/lib/server/csrf";
import { constantTimeTextEqual } from "@/lib/server/crypto";
import { adminConfig } from "@/lib/server/env";
import { assertAllowedOrigin, noStoreJson, parseJsonBody } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    await enforceClientRateLimit(request, "recovery");
    const state = await readAuthState();
    const proof = readRecoveryProof(request, state);
    if (!proof || adminConfig().disabled || state.state !== "RECOVERY") {
      throw new AuthenticationFlowError();
    }
    assertCsrf(request, proof.sid);
    const body = await parseJsonBody(request, registrationBodySchema, 128 * 1024);
    const ceremony = readCeremony(request, "recovery", proof.sid, state);
    if (
      !ceremony ||
      !ceremony.recoveryCodeHash ||
      !constantTimeTextEqual(ceremony.recoveryCodeHash, proof.recoveryCodeHash) ||
      !(await burnCeremony(ceremony))
    ) {
      throw new AuthenticationFlowError();
    }

    let passkey;
    try {
      passkey = await verifyRegistration(registrationResponse(body), ceremony);
    } catch {
      throw new AuthenticationFlowError();
    }
    if (state.passkeys.some((candidate) => candidate.id === passkey.id)) {
      throw new AuthenticationFlowError();
    }

    const response = noStoreJson({ ok: true, verified: true, finalizeRequired: true });
    clearCeremony(response);
    setPendingRecovery(response, proof, passkey);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.recovery");
    }
    return routeError(error);
  }
}
