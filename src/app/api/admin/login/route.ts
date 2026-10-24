import { withDiagnostics } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validAdminMutation } from "@/lib/admin-mutation";
import { adminCookie, adminCookieOptions, clearAdminCookie, createAdminSession, revokeAdminSession } from "@/lib/admin-auth";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { verifyAdminPassword } from "@/lib/admin-recovery";
import { hasCurrentPasskey } from "@/lib/admin-passkeys";
import { executeDuePasskeyReset, notifyRecoveryMailbox, passwordSetupAllowed } from "@/lib/admin-passkey-recovery";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

async function diagnosedPOST(request: Request) {
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
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
  // A due recovery-code passkey reset executes only here, after the password
  // was verified and the 48-hour cancellation window has elapsed.
  if (await executeDuePasskeyReset() === "executed") {
    await writeSecurityEvent({ ...context, event: "admin.passkey", outcome: "allowed", actor: "admin", reason: "recovery_reset_executed", metadata: { auth_factor: "password" } });
    await notifyRecoveryMailbox("SpeedZone admin passkeys were reset", "The scheduled passkey reset completed after its 48-hour waiting period. All previous passkeys were removed and all sessions were signed out. A new passkey can now be enrolled. If you did not request this, contact your administrator immediately and rotate the admin password.");
  }
  if (!await hasCurrentPasskey() && await passwordSetupAllowed()) {
    // No current passkey and enrollment is allowed (a fresh install, or once
    // after a completed passkey reset): issue the five-minute setup session
    // so the first or renewed passkey can be enrolled from it.
    const session = await createAdminSession(verification.credentialEpoch, "setup");
    if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
    await writeSecurityEvent({ ...context, event: "admin.session.created", outcome: "allowed", actor: "admin", reason: "setup_session_created", metadata: { auth_factor: "password", credential_epoch: verification.credentialEpoch } });
    (await cookies()).set(adminCookie.name, session, adminCookieOptions("setup"));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  // A passkey is no longer required to use the inventory admin: a verified
  // password opens a full session. Passkey sign-in and management stay
  // available as an option, but nothing gates on them. This means a
  // compromised admin password (including via a mailbox password reset) now
  // yields admin access; see docs/admin-passkey-recovery.md.
  const session = await createAdminSession(verification.credentialEpoch, "passkey");
  if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
  await writeSecurityEvent({ ...context, event: "admin.session.created", outcome: "allowed", actor: "admin", reason: "password_session_created", metadata: { auth_factor: "password", credential_epoch: verification.credentialEpoch } });
  (await cookies()).set(adminCookie.name, session, adminCookieOptions());
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
