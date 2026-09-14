import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { createSecuritySession, privateHeaders, SECURITY_COOKIE, securityCookieOptions } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, "password-login", 5, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } });
  const body = await request.json().catch(() => ({})) as { password?: string };
  const result = await verifyPassword(body.password ?? "");
  if (!result.ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401, headers: privateHeaders });
  const session = await createSecuritySession(result.epoch, "password");
  if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
  const response = NextResponse.json({ ok: true, next: "/login/passkey" }, { headers: privateHeaders });
  response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
}
