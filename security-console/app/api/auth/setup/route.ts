import { NextResponse } from "next/server";
import { initializePassword } from "@/lib/password";
import { createSecuritySession, privateHeaders, SECURITY_COOKIE, securityCookieOptions } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, "setup", 3, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Setup temporarily unavailable" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } });
  const body = await request.json().catch(() => ({})) as { bootstrapToken?: string; password?: string };
  const result = await initializePassword(body.bootstrapToken ?? "", body.password ?? "");
  if (!result.ok) return NextResponse.json({ error: result.reason === "already_configured" ? "Console setup is already complete" : "Setup could not be completed" }, { status: result.reason === "already_configured" ? 409 : 400, headers: privateHeaders });
  const session = await createSecuritySession(result.epoch, "password");
  if (!session) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503, headers: privateHeaders });
  const response = NextResponse.json({ ok: true, next: "/passkeys" }, { headers: privateHeaders });
  response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
}
