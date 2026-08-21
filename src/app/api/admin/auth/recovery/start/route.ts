import { NextRequest } from "next/server";
import { z } from "zod";

import {
  AuthenticationFlowError,
  administratorSchema,
  authenticationFailureResponse,
  clearAuthenticationFailures,
  createRecoveryProof,
  passwordSchema,
  setRecoveryProof,
} from "@/app/api/admin/auth/_shared";
import { verifyAdministrator } from "@/lib/server/auth/password";
import { findRecoveryCodeHash } from "@/lib/server/auth/recovery";
import { readPreAuthentication } from "@/lib/server/auth/session";
import { clearAuthenticationCookies } from "@/lib/server/cookies";
import { nextSessionEpoch } from "@/lib/server/crypto";
import { assertCsrf, issueCsrf } from "@/lib/server/csrf";
import { assertAllowedOrigin, noStoreJson, parseJsonBody } from "@/lib/server/request";
import { enforceRateLimit, routeError } from "@/lib/server/route-utils";
import {
  StateConflictError,
  mutateAuthState,
  readAuthState,
} from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    identifier: administratorSchema,
    password: passwordSchema,
    recoveryCode: z.string().trim().min(1).max(256),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const state = await readAuthState();
    const preAuthentication = readPreAuthentication(request, state);
    assertCsrf(request, preAuthentication?.sid ?? "anonymous");
    enforceRateLimit(request, "recovery", "administrator-recovery");
    const body = await parseJsonBody(request, bodySchema, 8_192);
    const passwordValid = await verifyAdministrator(body.identifier, body.password);
    const matchedHash = findRecoveryCodeHash(body.recoveryCode, state.recoveryCodeHashes);
    if (
      !passwordValid ||
      !matchedHash ||
      (state.state !== "ACTIVE" && state.state !== "RECOVERY") ||
      state.recoveryCodeHashes.length === 0
    ) {
      return authenticationFailureResponse(request, "auth.recovery");
    }

    const recoveryState =
      state.state === "RECOVERY"
        ? state
        : await mutateAuthState(
            (current) => {
              if (
                current.state !== "ACTIVE" ||
                !current.recoveryCodeHashes.includes(matchedHash)
              ) {
                throw new AuthenticationFlowError();
              }
              return {
                ...current,
                state: "RECOVERY",
                sessionEpoch: nextSessionEpoch(current.sessionEpoch),
                revokedSessionHashes: [],
              };
            },
            state.revision,
          );
    const proof = createRecoveryProof(recoveryState, matchedHash);
    const cookieResponse = noStoreJson({ ok: true, recoveryAuthorized: true, csrfToken: "pending" });
    clearAuthenticationCookies(cookieResponse);
    setRecoveryProof(cookieResponse, proof);
    const csrfToken = issueCsrf(cookieResponse, proof.sid);
    const response = noStoreJson({ ok: true, recoveryAuthorized: true, csrfToken });
    for (const cookie of cookieResponse.cookies.getAll()) response.cookies.set(cookie);
    clearAuthenticationFailures(request);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError || error instanceof StateConflictError) {
      return authenticationFailureResponse(request, "auth.recovery");
    }
    return routeError(error);
  }
}
