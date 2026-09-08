import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration, createAdminSession } from "@/lib/admin-passkeys";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (action === "registration-options") {
    const result = await registrationOptions();
    return NextResponse.json(result, { status: result.error ? 403 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "register") {
    const result = await verifyRegistration(body.response);
    return NextResponse.json(result, { status: result.error ? 400 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "authentication-options") {
    const result = await authenticationOptions();
    return NextResponse.json(result, { status: result.error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "authenticate") {
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = await checkAdminLoginRateLimit(`passkey:${client}`);
    if (!limit.configured) return NextResponse.json({ error: "Passkey login is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (!limit.success) return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfter) } });
    const result = await verifyAuthentication(body.response);
    if (!result.verified) return NextResponse.json(result, { status: 401, headers: { "Cache-Control": "no-store" } });
    const session = createAdminSession();
    if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
    const response = NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("speedzone_admin", session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return response;
  }
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "Unsupported passkey action" }, { status: 400 });
}
