import { consolePath } from "../../../../lib/paths";
import { NextResponse } from "next/server";
import { verifyPassword } from "../../../../lib/password";
import { createSecuritySession, privateHeaders, revokeSecuritySession, SECURITY_COOKIE, securityCookieOptions } from "../../../../lib/auth";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { recordConsoleAudit } from "../../../../lib/console-audit";

export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, "password-login", 5, 900);
  if (!rate.allowed) { await recordConsoleAudit(request,"console.login","denied","rate_limited"); return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } }); }
  const body = await request.json().catch(() => ({})) as { password?: string };
  const result = await verifyPassword(body.password ?? "");
  if (!result.ok) { await recordConsoleAudit(request,"console.login",result.reason==="unavailable"?"unavailable":"denied",result.reason); return NextResponse.json({ error: "Invalid credentials" }, { status: 401, headers: privateHeaders }); }
  await revokeSecuritySession(request);
  const session = await createSecuritySession(result.epoch, "password");
  if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
  const response = NextResponse.json({ ok: true, next: consolePath("/login/passkey") }, { headers: privateHeaders });
  await recordConsoleAudit(request,"console.login","allowed","password_verified");
  response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
}
