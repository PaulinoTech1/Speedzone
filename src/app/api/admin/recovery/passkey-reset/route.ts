import { withDiagnostics } from "@/lib/diagnostics";
import { auditRoute, securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { NextResponse } from "next/server";
import { checkAdminLoginRateLimit } from "@/lib/admin-login-rate-limit";
import { validAdminMutation } from "@/lib/admin-mutation";
import { readBoundedJson } from "@/lib/shared/mutation-request";
import { notifyRecoveryMailbox, PASSKEY_RESET_DELAY_MS, schedulePasskeyReset } from "@/lib/admin-passkey-recovery";

const noStore = { "Cache-Control": "no-store" };

// Schedules (never performs) a full passkey reset. Requires the emailed
// recovery token AND an offline recovery code; see admin-passkey-recovery.ts.
async function handlePOST(request: Request) {
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: noStore });
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return NextResponse.json({ error: "JSON request required" }, { status: 415, headers: noStore });
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  let limit;
  try { limit = await checkAdminLoginRateLimit(`passkey-reset:${client}`); } catch { return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: noStore }); }
  if (!limit.configured) return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: noStore });
  if (!limit.success) return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfter) } });
  let body: unknown;
  try { body = await readBoundedJson(request, 4096); } catch { return NextResponse.json({ error: "Invalid recovery request." }, { status: 400, headers: noStore }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid recovery request." }, { status: 400, headers: noStore });
  const { token, recoveryCode } = body as { token?: unknown; recoveryCode?: unknown };
  const result = await schedulePasskeyReset(token, recoveryCode);
  if (result.status === "unavailable") return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503, headers: noStore });
  if (result.status === "already_pending") return NextResponse.json({ error: "A passkey reset is already pending." }, { status: 409, headers: noStore });
  if (result.status !== "scheduled") return NextResponse.json({ error: "The recovery link or recovery code is invalid. Request a new recovery email to try again." }, { status: 400, headers: noStore });
  await writeSecurityEvent({ ...securityRequestContext(request, true), event: "admin.passkey", outcome: "allowed", actor: "anonymous", reason: "recovery_reset_scheduled", metadata: { execute_at: new Date(result.executeAt).toISOString() } });
  await notifyRecoveryMailbox("SpeedZone admin passkey reset scheduled", `A reset of ALL SpeedZone admin passkeys was requested with the emailed recovery link and a recovery code. It can complete after ${new Date(result.executeAt).toUTCString()} (${PASSKEY_RESET_DELAY_MS / 3_600_000} hours), at the next password sign-in.\n\nIf you did not request this, sign in with any existing passkey and cancel the pending reset, then change the admin password and regenerate recovery codes.`);
  return NextResponse.json({ ok: true, executeAt: new Date(result.executeAt).toISOString() }, { status: 202, headers: noStore });
}

async function diagnosedPOST(request: Request) { return auditRoute(request, "admin.recovery", () => handlePOST(request), "passkey_reset"); }
export async function POST(request: Request) { return withDiagnostics("ADMIN_PASSKEY_RESET_REQUEST", () => diagnosedPOST(request)); }
