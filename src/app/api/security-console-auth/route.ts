import { NextResponse } from "next/server";

import {
  authenticationOptions,
  clearSecuritySessionCookie,
  createSecuritySession,
  deleteSecurityPasskey,
  loginWithSecurityPassword,
  listSecurityPasskeys,
  registrationOptions,
  securitySessionCookie,
  securityLoginIdentifier,
  securityWebAuthnConfig,
  verifyAuthentication,
  verifyRegistration,
} from "../../../../security-console/lib/security-auth";

export const dynamic = "force-dynamic";

function sessionHeaders(token: string) {
  const cookie = securitySessionCookie(token);
  return { "Set-Cookie": `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie.maxAge}${cookie.secure ? "; Secure" : ""}` };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: string; password?: string; name?: string; id?: string; response?: unknown };
  const config = securityWebAuthnConfig(request.headers);

  if (body.action === "password-login") {
    const result = await loginWithSecurityPassword(body.password || "", securityLoginIdentifier(request.headers));
    if ("retryAfter" in result) return NextResponse.json(result, { status: 429, headers: { "Retry-After": String(result.retryAfter) } });
    if (!("authenticated" in result)) return NextResponse.json(result, { status: 401 });
    const token = await createSecuritySession("password");
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: sessionHeaders(token) });
  }

  if (body.action === "authentication-options") {
    const result = await authenticationOptions(config);
    return "options" in result ? NextResponse.json(result) : NextResponse.json(result, { status: 400 });
  }
  if (body.action === "authentication-verify") {
    const result = await verifyAuthentication(body.response, config);
    if (!("verified" in result)) return NextResponse.json(result, { status: 401 });
    const token = await createSecuritySession();
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: sessionHeaders(token) });
  }

  if (body.action === "registration-options") {
    const result = await registrationOptions(config);
    return "options" in result ? NextResponse.json(result) : NextResponse.json(result, { status: 400 });
  }
  if (body.action === "registration-verify") {
    const result = await verifyRegistration(body.response, body.name || "", config);
    if (!("verified" in result)) return NextResponse.json(result, { status: 400 });
    const token = await createSecuritySession("mfa");
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true, verified: true }, { headers: sessionHeaders(token) });
  }
  if (body.action === "passkeys") {
    const result = await listSecurityPasskeys();
    return "passkeys" in result ? NextResponse.json(result) : NextResponse.json(result, { status: 401 });
  }
  if (body.action === "delete-passkey") {
    const result = await deleteSecurityPasskey(body.id || "");
    return "deleted" in result ? NextResponse.json(result) : NextResponse.json(result, { status: 401 });
  }
  if (body.action === "logout") {
    const cookie = clearSecuritySessionCookie();
    return NextResponse.json({ authenticated: false }, { headers: { "Set-Cookie": `${cookie.name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookie.secure ? "; Secure" : ""}` } });
  }

  return NextResponse.json({ error: "Unknown authentication action" }, { status: 400 });
}
