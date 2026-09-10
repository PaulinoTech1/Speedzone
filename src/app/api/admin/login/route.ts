import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminCookieOptions, clearAdminCookie, createAdminSession, revokeAdminSession } from "@/lib/admin-auth";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { verifyAdminPassword } from "@/lib/admin-recovery";

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const rateLimit = await checkAdminLoginRateLimit(`ip:${getClientIdentifier(request)}`);
  if (!rateLimit.configured) {
    return NextResponse.json(
      { error: "Admin login is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfter),
        },
      },
    );
  }

  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string") return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  const verification = await verifyAdminPassword(password);
  if (!verification.verified) {
    return NextResponse.json({ error: verification.reason === "unavailable" ? "Admin authentication is temporarily unavailable" : "Invalid password" }, { status: verification.reason === "unavailable" ? 503 : 401 });
  }
  const session = await createAdminSession(verification.credentialEpoch);
  if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
  (await cookies()).set("speedzone_admin", session, adminCookieOptions());
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  await revokeAdminSession(request);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const cookie = clearAdminCookie();
  response.cookies.set(cookie.name, cookie.value, adminCookieOptions());
  return response;
}
