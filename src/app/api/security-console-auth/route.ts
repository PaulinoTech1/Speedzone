import { NextResponse } from "next/server";

import {
  authenticationOptions,
  createSecuritySession,
  loginWithSecurityPassword,
  securitySessionCookie,
  securityWebAuthnConfig,
  verifyAuthentication,
} from "../../../../security-console/lib/security-auth";

export const dynamic = "force-dynamic";

function sessionHeaders(token: string) {
  const cookie = securitySessionCookie(token);
  return { "Set-Cookie": `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie.maxAge}${cookie.secure ? "; Secure" : ""}` };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: string; password?: string; response?: unknown };
  const config = securityWebAuthnConfig(request.headers);

  if (body.action === "password-login") {
    const result = await loginWithSecurityPassword(body.password || "");
    if (!("authenticated" in result)) return NextResponse.json(result, { status: 401 });
    const token = await createSecuritySession();
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: sessionHeaders(token) });
  }

  if (body.action === "authentication-options") return NextResponse.json(await authenticationOptions(config));
  if (body.action === "authentication-verify") {
    const result = await verifyAuthentication(body.response, config);
    if (!("verified" in result)) return NextResponse.json(result, { status: 401 });
    const token = await createSecuritySession();
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: sessionHeaders(token) });
  }

  return NextResponse.json({ error: "Unknown authentication action" }, { status: 400 });
}
