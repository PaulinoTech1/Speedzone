import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { cookieNames, setHostCookie } from "@/lib/server/cookies";
import { constantTimeTextEqual, randomToken } from "@/lib/server/crypto";
import { RequestValidationError } from "@/lib/server/request";
import { noStoreJson } from "@/lib/server/request";
import { openToken, sealToken } from "@/lib/server/token";

type CsrfClaims = {
  typ: "csrf-v1";
  token: string;
  bind: string;
  expiresAt: number;
};

const csrfLifetimeSeconds = 30 * 60;

export function issueCsrf(response: NextResponse, bind: string, now = Date.now()): string {
  const token = randomToken(32);
  const claims: CsrfClaims = {
    typ: "csrf-v1",
    token,
    bind,
    expiresAt: now + csrfLifetimeSeconds * 1000,
  };
  setHostCookie(response, cookieNames.csrf, sealToken(claims), csrfLifetimeSeconds);
  return token;
}

export function csrfResponse(bind: string, now = Date.now()): NextResponse {
  const response = noStoreJson({ ok: true, csrfToken: "pending" });
  const token = issueCsrf(response, bind, now);
  return noStoreJsonWithCookie(response, { ok: true, csrfToken: token });
}

function noStoreJsonWithCookie(cookieSource: NextResponse, body: unknown): NextResponse {
  const response = noStoreJson(body);
  for (const cookie of cookieSource.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export function assertCsrf(request: NextRequest, bind: string, now = Date.now()): void {
  const headerToken = request.headers.get("x-csrf-token") ?? "";
  const claims = openToken<CsrfClaims>(request.cookies.get(cookieNames.csrf)?.value);
  if (
    !claims ||
    claims.typ !== "csrf-v1" ||
    claims.expiresAt <= now ||
    !constantTimeTextEqual(claims.bind, bind) ||
    !constantTimeTextEqual(claims.token, headerToken)
  ) {
    throw new RequestValidationError("Request rejected", 403, "REQUEST_REJECTED");
  }
}
