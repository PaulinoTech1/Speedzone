import { withDiagnostics } from "@/lib/diagnostics";
import { auditRoute, securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { NextResponse } from "next/server";
import { adminCookie, adminCookieOptions, createAdminSession, isAdmin } from "@/lib/admin-auth";
import { authenticationOptions, credentialActionOptions, verifyCredentialAction, deletePasskey, getWebAuthnConfig, listPasskeys, registrationOptions, verifyAuthentication, verifyRegistration } from "@/lib/admin-passkeys";
import { validAdminMutation } from "@/lib/admin-mutation";
import { readBoundedJson, RequestBodyError } from "../../../../../security-console/shared/mutation-request";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { admitAuthenticationOptions, clientAddress } from "@/lib/passkey-options-rate-limit";

async function handlePOST(request: Request, body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const action = (body as { action?: unknown }).action;
  const webAuthnConfig = getWebAuthnConfig(request.headers);
  if (typeof action !== "string") return NextResponse.json({ error: "Unsupported passkey action" }, { status: 400 });
  if (action === "reauthentication-options" || action === "reauthenticate") {
    if (body.operation !== "add" && body.operation !== "delete") return NextResponse.json({ error: "Invalid credential action" }, { status: 400 });
    const target = body.operation === "delete" && typeof body.id === "string" ? body.id : "";
    if (body.operation === "delete" && !target) return NextResponse.json({ error: "Passkey not found" }, { status: 400 });
    const result = action === "reauthentication-options"
      ? await credentialActionOptions(request, webAuthnConfig, body.operation, target)
      : await verifyCredentialAction(request, body.response, webAuthnConfig, body.operation, target);
    return NextResponse.json(result, { status: "error" in result ? 403 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "registration-options") {
    const result = await registrationOptions(webAuthnConfig, request, body.grant);
    return NextResponse.json(result, { status: result.error ? 403 : 200, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "register") {
    const result = await verifyRegistration(body.response, typeof body.name === "string" ? body.name.trim().slice(0, 80) : "", webAuthnConfig, request, body.grant);
    if (!result.verified) return NextResponse.json(result, { status: 400, headers: { "Cache-Control": "no-store" } });
    // Managed enrollment keeps the authorizing session. Initial setup can
    // exchange only the generation returned by its successful atomic commit.
    if (!result.setupGeneration) return NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
    const session = await createAdminSession(result.credentialEpoch, "passkey", result.setupGeneration);
    if (!session) return NextResponse.json({ error: "Passkey added. Refresh and sign in with it to continue." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(adminCookie.name, session, adminCookieOptions());
    await writeSecurityEvent({ ...securityRequestContext(request,true), event: "admin.session.created", outcome: "allowed", actor: "admin", reason: "passkey_registration_session_created", metadata: { auth_factor: "passkey", credential_epoch: result.credentialEpoch } });
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
    response.cookies.set(adminCookie.name, session, adminCookieOptions());
    await writeSecurityEvent({ ...securityRequestContext(request,true), event: "admin.session.created", outcome: "allowed", actor: "admin", reason: "passkey_session_created", metadata: { auth_factor: "passkey", credential_epoch: credentialEpoch } });
    return response;
  }
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (action === "list") return NextResponse.json({ passkeys: await listPasskeys() }, { headers: { "Cache-Control": "no-store" } });
  if (action === "delete") {
    const result = await deletePasskey(typeof body.id === "string" ? body.id : "", request, body.grant);
    return NextResponse.json(result, { status: result.deleted ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "Unsupported passkey action" }, { status: 400 });
}

async function diagnosedPOST(request: Request) {
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError(400, "Invalid request");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const actions = ["register", "authenticate", "delete", "list", "registration-options", "authentication-options", "reauthentication-options", "reauthenticate"];
  const action = typeof body?.action === "string" && actions.includes(body.action) ? body.action : "invalid_action";
  return auditRoute(request, "admin.passkey", () => handlePOST(request, body), action, ["authenticate", "register", "delete", "list"].includes(action) ? "admin" : "anonymous");
}

export async function POST(request: Request) { return withDiagnostics("ADMIN_PASSKEY_OPERATION", () => diagnosedPOST(request)); }
