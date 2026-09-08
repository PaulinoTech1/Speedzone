import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminCookieOptions, clearAdminCookie, createAdminSession } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({}));
  if (!process.env.SPEEDZONE_ADMIN_PASSWORD || password !== process.env.SPEEDZONE_ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const session = createAdminSession();
  if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
  (await cookies()).set("speedzone_admin", session, adminCookieOptions());
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const cookie = clearAdminCookie();
  response.cookies.set(cookie.name, cookie.value, adminCookieOptions());
  return response;
}
