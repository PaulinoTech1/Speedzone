import { NextResponse } from "next/server";
import { consumeRecoveryToken, setAdminPassword } from "@/lib/admin-recovery";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12 || password.length > 128) return NextResponse.json({ error: "Password must be between 12 and 128 characters." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!/\S/.test(password)) return NextResponse.json({ error: "Password cannot be blank." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const valid = await consumeRecoveryToken(token);
  if (!valid) return NextResponse.json({ error: "This recovery link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const saved = await setAdminPassword(password);
  if (!saved) return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
