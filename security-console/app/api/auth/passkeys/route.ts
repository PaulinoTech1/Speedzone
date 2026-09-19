import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { privateHeaders, SECURITY_COOKIE, securityCookieOptions, upgradeSecuritySession, validateSecuritySession } from "../../../../lib/auth";
import { authenticationOptions, deletePasskey, getWebAuthnConfig, listPasskeys, registrationOptions, requestOrigin, verifyAuthentication, verifyRegistration } from "../../../../lib/passkeys";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { recordConsoleAudit } from "../../../../lib/console-audit";
import { logAuthenticationFailure } from "../../../../lib/auth-health";
import { firstPasskeyOptions, verifyFirstPasskey, recoveryRegistrationOptions, verifyRecoveryRegistration } from "../../../../lib/passkeys";

export async function GET(request: Request) {
  if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  return NextResponse.json({ passkeys: await listPasskeys() }, { headers: privateHeaders });
}
export async function POST(request: Request) {
  try {
  const rate = await enforceRateLimit(request, "passkey", 12, 300);
  if (!rate.allowed) { await recordConsoleAudit(request,"console.passkey","denied","rate_limited"); return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } }); }
  const body = await request.json().catch(() => ({})) as { action?: string; response?: unknown; name?: string; code?: unknown };
  const config = getWebAuthnConfig(await headers());
  const origin = requestOrigin(request, config);
  if (body.action === "bootstrap-options" || body.action === "bootstrap") {
    if (!origin || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return NextResponse.json({ error: "Invalid setup request" }, { status: 403, headers: privateHeaders });
    }
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Enter your password first" }, { status: 401, headers: privateHeaders });
    const result = body.action === "bootstrap-options"
      ? await firstPasskeyOptions(request, config)
      : await verifyFirstPasskey(request, body.response, config);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
    if ("verified" in result) await recordConsoleAudit(request, "console.passkey", "allowed", "first_registered");
    // Only a subsequent signed assertion can elevate the password session.
    return NextResponse.json(result, { headers: privateHeaders });
  }
  if (body.action === "recovery-options" || body.action === "recover") {
    if (!origin || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return NextResponse.json({ error: "Invalid recovery request" }, { status: 403, headers: privateHeaders });
    }
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Enter your password first" }, { status: 401, headers: privateHeaders });
    const recoveryRate = await enforceRateLimit(request, "passkey-recovery", 6, 300);
    if (!recoveryRate.allowed) return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(recoveryRate.retryAfter) } });
    const result = body.action === "recovery-options"
      ? await recoveryRegistrationOptions(request, body.code, config)
      : await verifyRecoveryRegistration(request, body.response, String(body.name ?? "Recovered security passkey").slice(0, 80), config);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
    if ("verified" in result) await recordConsoleAudit(request, "console.passkey", "allowed", "recovered");
    // Registration leaves this session password-only. The new key must assert.
    return NextResponse.json(result, { headers: privateHeaders });
  }
  if (body.action === "registration-options") {
    if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Verify your established passkey first" }, { status: 401, headers: privateHeaders });
    if (!origin) return NextResponse.json({ error: "Invalid setup request" }, { status: 403, headers: privateHeaders });
    return NextResponse.json(await registrationOptions(config, origin), { headers: privateHeaders });
  }
  if (body.action === "register") {
    if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Verify your established passkey first" }, { status: 401, headers: privateHeaders });
    const verified = await verifyRegistration(body.response, String(body.name ?? "Security passkey").slice(0, 80), config);
    if (!("verified" in verified) || verified.verified !== true) return NextResponse.json(verified, { status: 400, headers: privateHeaders });
    await recordConsoleAudit(request,"console.passkey","allowed","registered");
    return NextResponse.json({ verified: true }, { headers: privateHeaders });
  }
  if (body.action === "authentication-options") {
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    if (!origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: privateHeaders });
    const result = await authenticationOptions(config, origin);
    if ("error" in result) {
      await logAuthenticationFailure(result.status === 403 ? "no_active_passkey" : "storage_unavailable");
      return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
    }
    return NextResponse.json(result, { headers: privateHeaders });
  }
  if (body.action === "authenticate") {
    if (!await validateSecuritySession(request, "password")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    const verified = await verifyAuthentication(body.response, config);
    if (!("verified" in verified) || verified.verified !== true) {
      await logAuthenticationFailure("assertion_denied");
      await recordConsoleAudit(request,"console.login","denied","assertion_denied");
      return NextResponse.json(verified, { status: 401, headers: privateHeaders });
    }
    const session = await upgradeSecuritySession(request, verified.credentialEpoch); if (!session) {
      await logAuthenticationFailure("session_upgrade_denied");
      return NextResponse.json({ error: "Your login expired. Enter your password and verify your passkey again." }, { status: 401, headers: privateHeaders });
    }
    await recordConsoleAudit(request,"console.login","allowed","passkey_verified");
    const response = NextResponse.json({ verified: true }, { headers: privateHeaders }); response.cookies.set(SECURITY_COOKIE, session, securityCookieOptions); return response;
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: privateHeaders });
  } catch {
    await logAuthenticationFailure("storage_unavailable");
    return NextResponse.json({ error: "Security Console authentication is unavailable. Please try again later." }, { status: 503, headers: privateHeaders });
  }
}
export async function DELETE(request: Request) {
  if (!await validateSecuritySession(request, "mfa")) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const result = await deletePasskey(id); if(result.deleted)await recordConsoleAudit(request,"console.passkey","allowed","removed"); return NextResponse.json(result, { status: result.deleted ? 200 : 409, headers: privateHeaders });
}
