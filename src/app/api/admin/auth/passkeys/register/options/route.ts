import { NextRequest } from "next/server";
import { z } from "zod";

import {
  labelSchema,
  requireEnabledAdministrator,
  requireFreshStepUp,
} from "@/app/api/admin/auth/_shared";
import { sessionDigest } from "@/lib/server/auth/session";
import { registrationOptions, setCeremony } from "@/lib/server/auth/webauthn";
import { noStoreJson, parseJsonBody } from "@/lib/server/request";
import { assertAdminMutation, enforceRateLimit, routeError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ label: labelSchema }).strict();

export async function POST(request: NextRequest) {
  try {
    const { claims, state } = await requireEnabledAdministrator(request);
    assertAdminMutation(request, claims);
    requireFreshStepUp(request, claims);
    await enforceRateLimit(request, "passkeyManagement", `register:${sessionDigest(claims.sid)}`);
    const body = await parseJsonBody(request, bodySchema, 4_096);
    const { options, ceremony } = await registrationOptions(
      state,
      "add-passkey",
      claims.sid,
      body.label,
    );
    const response = noStoreJson({ ok: true, options });
    setCeremony(response, ceremony);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
