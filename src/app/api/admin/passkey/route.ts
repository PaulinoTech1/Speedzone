import { withDiagnostics } from "@/lib/diagnostics";
import { auditRoute } from "@/lib/security-events";
import { NextResponse } from "next/server";
import { adminCookieOptions, createAdminSession, isAdmin } from "@/lib/admin-auth";
import { authenticationOptions, deletePasskey, getWebAuthnConfig, listPasskeys, registrationOptions, verifyAuthentication, verifyRegistration } from "@/lib/admin-passkeys";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { admitAuthenticationOptions, clientAddress } from "@/lib/passkey-options-rate-limit";

async function handlePOST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "JSON request required" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const action = (body as { action?: unknown }).action;
  const webAuthnConfig = getWebAuthnConfig(request.headers);
  if (typeof action !== "string") return NextResponse.json({ error: "Unsupported passkey action" }, { status: 400 });
  if (action === "registration-options") {
    const result = await registrationOptions(webAuthnConfig);
    return NextResponse.json(result, { status: result.error ? 403 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "register") {
    const result = await verifyRegistration(body.response, typeof body.name === "string" ? body.name.trim().slice(0, 80) : "", webAuthnConfig);
    if (!result.verified) return NextResponse.json(result, { status: 400, headers: { "Cache-Control": "no-store" } });
    const session = await createAdminSession(result.credentialEpoch, "passkey");
    if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("speedzone_admin", session, adminCookieOptions());
    return response;
  }
  if (action === "authentication-options") {
    const limit = await admitAuthenticationOptions(clientAddress(request.headers));
    if (!limit.configured) return NextResponse.json({ error: "Passkey login is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (!limit.success) return NextResponse.json({ error: "Too many passkey requests. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfter) } });
    const result = await authenticationOptions(webAuthnConfig);
    return NextResponse.json(result, { status: result.error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "authenticate") {
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = await checkAdminLoginRateLimit(`passkey:${client}`);
    if (!limit.configured) return NextResponse.json({ error: "Passkey login is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (!limit.success) return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfter) } });
    const result = await verifyAuthentication(body.response, webAuthnConfig);
    if (!result.verified) return NextResponse.json(result, { status: 401, headers: { "Cache-Control": "no-store" } });
    const credentialEpoch = result.credentialEpoch;
    if (typeof credentialEpoch !== "number") return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
    const session = await createAdminSession(credentialEpoch, "passkey");
    if (!session) return NextResponse.json({ error: "Admin authentication is not configured" }, { status: 503 });
    const response = NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("speedzone_admin", session, adminCookieOptions());
    return response;
  }
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (action === "list") return NextResponse.json({ passkeys: await listPasskeys() }, { headers: { "Cache-Control": "no-store" } });
  if (action === "delete") {
    const result = await deletePasskey(typeof body.id === "string" ? body.id : "");
    return NextResponse.json(result, { status: result.deleted ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "Unsupported passkey action" }, { status: 400 });
}

async function diagnosedPOST(request: Request) {
  const body = await request.clone().json().catch(() => null);
  const actions = ["register", "authenticate", "delete", "list", "registration-options", "authentication-options"];
  const action = typeof body?.action === "string" && actions.includes(body.action) ? body.action : "invalid_action";
  return auditRoute(request, "admin.passkey", () => handlePOST(request), action, ["authenticate", "register", "delete", "list"].includes(action) ? "admin" : "anonymous");
}

export async function POST(request: Request) { return withDiagnostics("ADMIN_PASSKEY_OPERATION", () => diagnosedPOST(request)); }
