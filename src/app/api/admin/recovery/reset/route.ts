import { NextResponse } from "next/server";
import { revokeAllAdminSessions } from "@/lib/admin-auth";
import { consumeRecoveryToken, replaceAdminPassword } from "@/lib/admin-recovery";
import { revokeAllPasskeysAndChallenges } from "@/lib/admin-passkeys";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "JSON request required" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid recovery request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12 || password.length > 128) return NextResponse.json({ error: "Password must be between 12 and 128 characters." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!/\S/.test(password)) return NextResponse.json({ error: "Password cannot be blank." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const consumption = await consumeRecoveryToken(token);
  if (consumption.status === "invalid_or_expired") {
    return NextResponse.json({ error: "This recovery link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (consumption.status === "storage_unavailable") {
    return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const saved = await replaceAdminPassword(password);
    if (!saved || !(await revokeAllPasskeysAndChallenges())) return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    await revokeAllAdminSessions();
  } catch {
    console.warn("[recovery] failed after token consumption");
    return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[recovery] password recovery completed");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
