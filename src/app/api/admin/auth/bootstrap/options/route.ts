import { NextRequest } from "next/server";
import { z } from "zod";

import {
  AuthenticationFlowError,
  authenticationFailureResponse,
  labelSchema,
  requireBootstrapPreAuthentication,
} from "@/app/api/admin/auth/_shared";
import { registrationOptions, setCeremony } from "@/lib/server/auth/webauthn";
import { assertCsrf } from "@/lib/server/csrf";
import { adminConfig } from "@/lib/server/env";
import {
  assertBootstrapEnrollmentRequest,
  noStoreJson,
  parseStrictJsonBody,
} from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { StateConfigurationError, readAuthState } from "@/lib/server/storage/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ label: labelSchema }).strict();

export async function POST(request: NextRequest) {
  try {
    assertBootstrapEnrollmentRequest(request);
    await enforceClientRateLimit(request, "passkeyManagement");
    const state = await readAuthState();
    if (state.state !== "BOOTSTRAP_READY") throw new AuthenticationFlowError();
    if (!adminConfig().bootstrapTokenHash) {
      throw new StateConfigurationError("Bootstrap credential is not configured");
    }
    const preAuthentication = requireBootstrapPreAuthentication(request, state);
    assertCsrf(request, preAuthentication.sid);
    const body = await parseStrictJsonBody(request, bodySchema, 4_096);

    const { options, ceremony } = await registrationOptions(
      state,
      "bootstrap",
      preAuthentication.sid,
      body.label,
    );
    const response = noStoreJson({ ok: true, options });
    setCeremony(response, ceremony);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationFlowError) {
      return authenticationFailureResponse(request, "auth.bootstrap");
    }
    return routeError(error);
  }
}
