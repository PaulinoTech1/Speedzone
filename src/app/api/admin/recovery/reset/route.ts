import { NextResponse } from "next/server";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { revokeAllAdminSessions } from "@/lib/admin-auth";
import { resetAdminPasswordWithToken } from "@/lib/admin-recovery";

export async function POST(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkAdminLoginRateLimit(`recovery-reset:${client}`);
  if (!limit.configured) return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!limit.success) return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfter) } });
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
  const commit = await resetAdminPasswordWithToken(token, password);
  if (commit.status === "invalid_or_expired" || commit.status === "invalid") {
    return NextResponse.json({ error: "This recovery link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (commit.status === "storage_unavailable") {
    return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await revokeAllAdminSessions();
  } catch {
    console.warn("[recovery] credential committed; session revocation needs reconciliation");
  }
  console.info("[recovery] password recovery completed");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
