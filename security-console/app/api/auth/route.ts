import { NextResponse } from "next/server";

import {
  authenticationOptions,
  bootstrapSecurityPassword,
  clearSecuritySessionCookie,
  createSecuritySession,
  loginWithSecurityPassword,
  registrationOptions,
  securitySessionCookie,
  securityWebAuthnConfig,
  verifyAuthentication,
  verifyRegistration,
} from "../../../lib/security-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: string; password?: string; bootstrapToken?: string; response?: unknown; name?: string };
  const config = securityWebAuthnConfig(request.headers);

  if (body.action === "bootstrap") {
    const result = await bootstrapSecurityPassword(body.password || "", body.bootstrapToken || "");
    if (!("authenticated" in result)) return NextResponse.json(result, { status: 400 });
    const token = await createSecuritySession("mfa");
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: { "Set-Cookie": `${securitySessionCookie(token).name}=${securitySessionCookie(token).value}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });
  }

  if (body.action === "password-login") {
    const result = await loginWithSecurityPassword(body.password || "");
    if (!("authenticated" in result)) return NextResponse.json(result, { status: 401 });
    const token = await createSecuritySession("password");
    if (!token) return NextResponse.json({ error: "Security session could not be created" }, { status: 503 });
    return NextResponse.json({ authenticated: true }, { headers: { "Set-Cookie": `${securitySessionCookie(token).name}=${securitySessionCookie(token).value}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });
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
    return NextResponse.json({ authenticated: true }, { headers: { "Set-Cookie": `${securitySessionCookie(token).name}=${securitySessionCookie(token).value}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });
  }

  if (body.action === "registration-options") return NextResponse.json(await registrationOptions(config));
  if (body.action === "registration-verify") return NextResponse.json(await verifyRegistration(body.response, body.name || "", config));
  if (body.action === "logout") return NextResponse.json({ authenticated: false }, { headers: { "Set-Cookie": `${clearSecuritySessionCookie().name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });

  return NextResponse.json({ error: "Unknown authentication action" }, { status: 400 });
}
