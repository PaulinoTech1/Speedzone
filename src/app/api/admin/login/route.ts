import { withDiagnostics } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminCookieOptions, clearAdminCookie, createAdminSession, revokeAdminSession } from "@/lib/admin-auth";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { verifyAdminPassword } from "@/lib/admin-recovery";
import { hasCurrentPasskey } from "@/lib/admin-passkeys";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

async function diagnosedPOST(request: Request) {
  const context = securityRequestContext(request,true);
  const rateLimit = await checkAdminLoginRateLimit(`ip:${getClientIdentifier(request)}`);
  if (!rateLimit.configured) {
    await writeSecurityEvent({ ...context, event: "admin.login.rate_limited", outcome: "unavailable", actor: "anonymous", reason: "limiter_unavailable", metadata: { auth_factor: "password" } });
    return NextResponse.json(
      { error: "Admin login is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!rateLimit.success) {
    await writeSecurityEvent({ ...context, event: "admin.login.rate_limited", outcome: "denied", actor: "anonymous", reason: "attempt_limit_exceeded", metadata: { auth_factor: "password", retry_after_seconds: rateLimit.retryAfter } });
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
  await writeSecurityEvent({ ...context, event: "admin.login", outcome: verification.verified ? "allowed" : verification.reason === "unavailable" ? "unavailable" : "denied", actor: verification.verified ? "admin" : "anonymous", reason: verification.verified ? "password_verified" : verification.reason || "invalid_credentials", metadata: { auth_factor: "password", ...(verification.verified ? { credential_epoch: verification.credentialEpoch } : {}) } });
  if(verification.verified&&verification.credentialChange)await writeSecurityEvent({...context,event:"admin.password.changed",outcome:"allowed",actor:"admin",reason:verification.credentialChange,metadata:{credential_epoch:verification.credentialEpoch,prior_sessions_revoked:verification.credentialChange!=="metadata_repaired"}});
  if (!verification.verified) {
    return NextResponse.json({ error: verification.reason === "unavailable" ? "Admin authentication is temporarily unavailable" : "Invalid password" }, { status: verification.reason === "unavailable" ? 503 : 401 });
  }
  if (await hasCurrentPasskey()) {
    return NextResponse.json({ error: "Passkey sign-in is required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const session = await createAdminSession(verification.credentialEpoch, "setup");
  if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
  await writeSecurityEvent({ ...context, event: "admin.session.created", outcome: "allowed", actor: "admin", reason: "setup_session_created", metadata: { auth_factor: "password", credential_epoch: verification.credentialEpoch } });
  (await cookies()).set("speedzone_admin", session, adminCookieOptions());
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

async function diagnosedDELETE(request: Request) {
  await revokeAdminSession(request);
  await writeSecurityEvent({ ...securityRequestContext(request,true), event: "admin.logout", outcome: "allowed", actor: "anonymous", reason: "session_revoked" });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const cookie = clearAdminCookie();
  response.cookies.set(cookie.name, cookie.value, { ...adminCookieOptions(), maxAge: 0 });
  return response;
}

export async function POST(request: Request) { return withDiagnostics("ADMIN_PASSWORD_BOOTSTRAP", () => diagnosedPOST(request)); }

export async function DELETE(request: Request) { return withDiagnostics("ADMIN_SESSION_LOGOUT", () => diagnosedDELETE(request)); }
