import { NextResponse } from "next/server";
import { Resend } from "resend";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { createRecoveryToken, recoveryConfigured, recoveryEmail, recoveryTtlSeconds } from "@/lib/admin-recovery";

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let limit;
  try {
    limit = await checkAdminLoginRateLimit(`recovery:${clientKey(request)}`);
  } catch (error) {
    console.error("[v0] admin recovery rate limit failed", error);
    return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  }
  if (!limit.configured) return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  if (!limit.success) return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfter) } });
  if (!recoveryConfigured()) return NextResponse.json({ error: "Recovery is not configured" }, { status: 503, headers: noStore });
  const token = await createRecoveryToken();
  if (!token) return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: `SpeedZone Admin <admin@${domain}>`,
    to: [recoveryEmail],
    subject: "SpeedZone admin password recovery",
    text: `A password recovery was requested for SpeedZone inventory admin. Reset your password here: ${new URL(`/admin?recovery=${encodeURIComponent(token)}`, request.url)}\n\nThis link expires in ${Math.floor(recoveryTtlSeconds / 60)} minutes and can only be used once.`,
  }, { idempotencyKey: `admin-recovery/${token}` });
  if (error) return NextResponse.json({ error: "Unable to send recovery email" }, { status: 502, headers: noStore });
  return NextResponse.json({ ok: true, message: `If recovery is available, a link was sent to ${recoveryEmail}.` }, { headers: noStore });
}
