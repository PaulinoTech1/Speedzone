import { NextResponse } from "next/server";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
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
  const operationId = typeof body.operationId === "string" ? body.operationId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return NextResponse.json({ error: "Invalid recovery operation identifier." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (password.length < 12 || password.length > 128) return NextResponse.json({ error: "Password must be between 12 and 128 characters." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!/\S/.test(password)) return NextResponse.json({ error: "Password cannot be blank." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const commit = await resetAdminPasswordWithToken(token, password, operationId);
  if (commit.status === "operation_conflict") {
    return NextResponse.json({ error: "This recovery operation was already used with a different password." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (commit.status === "invalid_or_expired" || commit.status === "invalid") {
    return NextResponse.json({ error: "This recovery link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (commit.status === "storage_unavailable") {
    return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[recovery] password recovery committed; credential epoch invalidates prior sessions");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
