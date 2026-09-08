import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({}));
  if (!process.env.SPEEDZONE_ADMIN_PASSWORD || password !== process.env.SPEEDZONE_ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const store = await cookies();
  store.set("speedzone_admin", "authenticated", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete("speedzone_admin");
  return NextResponse.json({ ok: true });
}
