import { withDiagnostics } from "@/lib/diagnostics";
import { auditRoute } from "@/lib/security-events";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { createRecoveryToken, recoveryConfigured, recoveryEmail, recoveryTtlSeconds } from "@/lib/admin-recovery";

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

const noStore = { "Cache-Control": "no-store" };

async function handlePOST(request: Request) {
  let limit;
  try {
    limit = await checkAdminLoginRateLimit(`recovery:${clientKey(request)}`);
  } catch (error) {
    console.error("[v0] admin recovery rate limit failed", error);
    return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  }
  if (!limit.configured) return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  if (!limit.success) return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfter) } });
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email !== recoveryEmail) return NextResponse.json({ ok: true, message: "If the request is eligible, an email will be sent." }, { headers: noStore });
  if (!recoveryConfigured()) return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  const token = await createRecoveryToken();
  if (!token) return NextResponse.json({ error: "Recovery is temporarily unavailable" }, { status: 503, headers: noStore });
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  const recoveryApiKey = process.env.RESEND_PASSWORD_RESET_API_KEY;
  if (!domain || !recoveryApiKey) {
    return NextResponse.json({ error: "Recovery email is not configured" }, { status: 503, headers: noStore });
  }
  const resend = new Resend(recoveryApiKey);
  const { error } = await resend.emails.send({
    from: `SpeedZone Admin <admin@${domain}>`,
    to: [recoveryEmail],
    subject: "SpeedZone admin password recovery",
    text: `A password recovery was requested for SpeedZone inventory admin. Reset your password here: ${new URL(`/admin?recovery=${encodeURIComponent(token)}`, request.url)}\n\nThis link expires in ${Math.floor(recoveryTtlSeconds / 60)} minutes and can only be used once.`,
  }, { idempotencyKey: `admin-recovery/${token}` });
  if (error) return NextResponse.json({ error: "Unable to send recovery email" }, { status: 502, headers: noStore });
  return NextResponse.json({ ok: true, message: `If recovery is available, a link was sent to ${recoveryEmail}.` }, { headers: noStore });
}

async function diagnosedPOST(request: Request) { return auditRoute(request, "admin.recovery", () => handlePOST(request), "post"); }

export async function POST(request: Request) { return withDiagnostics("ADMIN_RECOVERY_REQUEST", () => diagnosedPOST(request)); }
