import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { privateHeaders, SECURITY_COOKIE, securityCookieOptions, upgradeSecuritySession, validateSecuritySession } from "@/lib/auth";
import { authenticationOptions, deletePasskey, getWebAuthnConfig, listPasskeys, registrationOptions, verifyAuthentication, verifyRegistration } from "@/lib/passkeys";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recordConsoleAudit } from "@/lib/console-audit";

export async function GET(request: Request) {
  if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  return NextResponse.json({ passkeys: await listPasskeys() }, { headers: privateHeaders });
}
export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, "passkey", 12, 300);
  if (!rate.allowed) { await recordConsoleAudit(request,"console.passkey","denied","rate_limited"); return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } }); }
  const body = await request.json().catch(() => ({})) as { action?: string; response?: unknown; name?: string };
  const config = getWebAuthnConfig(await headers());
  if (body.action === "registration-options") return NextResponse.json(await registrationOptions(config), { headers: privateHeaders });
  if (body.action === "register") {
    const verified = await verifyRegistration(body.response, String(body.name ?? "Security passkey").slice(0, 80), config);
    if (!("verified" in verified)) return NextResponse.json(verified, { status: 400, headers: privateHeaders });
    const session = await upgradeSecuritySession(request); if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
    await recordConsoleAudit(request,"console.passkey","allowed","registered");
    const response = NextResponse.json({ verified: true }, { headers: privateHeaders }); response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
  }
  if (body.action === "authentication-options") {
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    return NextResponse.json(await authenticationOptions(config), { headers: privateHeaders });
  }
  if (body.action === "authenticate") {
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    const verified = await verifyAuthentication(body.response, config);
    if (!("verified" in verified)) return NextResponse.json(verified, { status: 401, headers: privateHeaders });
    const session = await upgradeSecuritySession(request); if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
    await recordConsoleAudit(request,"console.login","allowed","passkey_verified");
    const response = NextResponse.json({ verified: true }, { headers: privateHeaders }); response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: privateHeaders });
}
export async function DELETE(request: Request) {
  if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const result = await deletePasskey(id); if(result.deleted)await recordConsoleAudit(request,"console.passkey","allowed","removed"); return NextResponse.json(result, { status: result.deleted ? 200 : 409, headers: privateHeaders });
}
