import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/security-console/password";
import { createSecuritySession, privateHeaders, SECURITY_COOKIE, securityCookieOptions } from "@/lib/security-console/auth";
import { enforceRateLimit } from "@/lib/security-console/rate-limit";
import { recordConsoleAudit } from "@/lib/security-console/console-audit";
import { hasCurrentPasskey } from "@/lib/security-console/passkeys";

export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, "password-login", 5, 900);
  if (!rate.allowed) { await recordConsoleAudit(request,"console.login","denied","rate_limited"); return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } }); }
  const body = await request.json().catch(() => ({})) as { password?: string };
  const result = await verifyPassword(body.password ?? "");
  if (!result.ok) { await recordConsoleAudit(request,"console.login",result.reason==="unavailable"?"unavailable":"denied",result.reason); return NextResponse.json({ error: "Invalid credentials" }, { status: 401, headers: privateHeaders }); }
  const session = await createSecuritySession(result.epoch, "password");
  if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
  const response = NextResponse.json({ ok: true, next: await hasCurrentPasskey() ? "/login/passkey" : "/passkeys" }, { headers: privateHeaders });
  await recordConsoleAudit(request,"console.login","allowed",result.migrated ? "legacy_password_migrated" : "password_verified");
  response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
}
