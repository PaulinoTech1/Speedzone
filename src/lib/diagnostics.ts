import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";

// Server-only values: the protected admin API is the only browser reader.
export const diagnosticOperations = {
  SERVER_RENDER_OR_FRAMEWORK_REQUEST: "Server rendering/framework failure: inspect deployment health and the affected route without collecting request bodies.",
  INVENTORY_CATALOG_READ: "Read inventory: check public Blob availability and catalog schema.",
  INVENTORY_LISTING_CREATE: "Create listing: check photo validation, revision and public Blob credentials.",
  INVENTORY_LISTING_UPDATE: "Update listing: compare browser revision with current catalog; check persistence.",
  INVENTORY_LISTING_REMOVE: "Remove references: check revision and Blob persistence. Photo objects are retained.",
  INVENTORY_PHOTO_UPLOAD_AUTHORIZE: "Issue upload token: check passkey session, photo path and public Blob origin.",
  INVENTORY_PHOTO_FETCH: "Fetch photo: check origin allowlist, signature, size and upstream availability.",
  CUSTOMER_REQUEST_ACCEPT: "Accept request: check private Blob, encryption key, limiter and UUID reuse.",
  CUSTOMER_REQUEST_INBOX_READ: "Read inbox: check authenticated admin session and private Blob/encryption settings.",
  CUSTOMER_REQUEST_INBOX_DELETE: "Delete request: check authenticated admin session and private Blob settings.",
  CUSTOMER_REQUEST_EMAIL_NOTIFY: "Notify staff: check Resend configuration/provider. Do not reverse acceptance.",
  ADMIN_PASSWORD_BOOTSTRAP: "Bootstrap enrollment: inspect Redis, credential state and login limiter.",
  ADMIN_SESSION_LOGOUT: "Revoke session: check Redis availability and cookie expiry.",
  ADMIN_PASSKEY_OPERATION: "Passkey operation: check RP ID, origin, challenge expiry and credential epoch.",
  ADMIN_RECOVERY_REQUEST: "Request recovery: check limiter, configured mailbox, Redis and email delivery.",
  ADMIN_RECOVERY_RESET: "Reset recovery: inspect operation ID, token expiry and epoch without logging secrets.",
  ADMIN_SESSION_RESOLVE: "Resolve session purpose: check expiry and Redis availability.",
  ADMIN_DIAGNOSTICS_READ: "Read diagnostics: require current passkey session and Redis availability.",
  RESPONSIBLE_BUG_REPORT_ACCEPT: "Accept bug report: check origin, limits, encryption settings and Redis.",
} as const;
export type DiagnosticOperation = keyof typeof diagnosticOperations;
const failures = {
  400: ["REQUEST_VALIDATION_REJECTED", "Review the request schema and sanitized validation paths."],
  401: ["AUTHENTICATED_SESSION_REQUIRED", "Verify the route-specific session: inventory and private inbox accept password/setup or passkey; diagnostics require passkey."],
  403: ["REQUEST_NOT_AUTHORIZED_BY_POLICY", "Check authorization, origin and resource allowlists."],
  404: ["REQUESTED_RESOURCE_NOT_AVAILABLE", "Check whether the resource still exists."],
  409: ["STATE_REVISION_OR_IDEMPOTENCY_CONFLICT", "Reload current state and reconcile the original operation before retrying."],
  413: ["REQUEST_EXCEEDS_ALLOWED_BYTE_LIMIT", "Check documented payload/file-size limits."],
  415: ["REQUEST_CONTENT_TYPE_NOT_SUPPORTED", "Send the expected content type; preserve signature validation."],
  422: ["STORED_CONTENT_CANNOT_BE_PROCESSED", "Check schema/encryption-key continuity; preserve original data."],
  429: ["DISTRIBUTED_RATE_LIMIT_EXCEEDED", "Respect Retry-After; inspect traffic before changing limits."],
  500: ["UNEXPECTED_OPERATION_FAILURE", "Inspect dependencies and recent changes using the reference and timestamp."],
  502: ["UPSTREAM_PROVIDER_REJECTED_OPERATION", "Inspect provider health/configuration without logging credentials."],
  503: ["REQUIRED_DEPENDENCY_OR_CONFIGURATION_UNAVAILABLE", "Verify environment-specific settings and service health."],
} as const;
export function diagnosticDefinition(operation: DiagnosticOperation, status: number) {
  const [reason, remediation] = failures[status as keyof typeof failures] || failures[500];
  return { code: `SPEEDZONE_${operation}_${reason}`, description: diagnosticOperations[operation], remediation };
}
export type DiagnosticRecord = ReturnType<typeof diagnosticDefinition> & { reference: string; operation: DiagnosticOperation; status: number; occurredAt: string };
const persistDiagnostic = `
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 60)
redis.call('SET', KEYS[2], ARGV[1], 'EX', 604800)
redis.call('LPUSH', KEYS[3], KEYS[2])
redis.call('LTRIM', KEYS[3], 0, 499)
redis.call('EXPIRE', KEYS[3], 604800)
return ARGV[2]
`;
export async function recordDiagnostic(operation: DiagnosticOperation, status: number) {
  const record: DiagnosticRecord = { ...diagnosticDefinition(operation, status), reference: randomUUID(), operation, status, occurredAt: new Date().toISOString() };
  try {
    const redis = getRedis();
    if (redis) {
      const reference = await redis.eval(persistDiagnostic, [`speedzone:diagnostic:sample:${record.code}`, `speedzone:diagnostic:event:${record.reference}`, "speedzone:diagnostic:index"], [JSON.stringify(record), record.reference]);
      if (typeof reference === "string") record.reference = reference;
    }
    else if (status >= 500) console.error("[diagnostic]", JSON.stringify(record));
  } catch { console.error("[diagnostic] persistence unavailable", record.code, record.reference); }
  return record;
}
export async function readDiagnostics() {
  const redis = getRedis(); if (!redis) throw new Error("Diagnostics unavailable");
  const keys = await redis.lrange<string>("speedzone:diagnostic:index", 0, 99);
  if (!keys.length) return [];
  return (await redis.mget<DiagnosticRecord[]>(...keys)).filter(Boolean);
}
export async function withDiagnostics(operation: DiagnosticOperation, handler: () => Promise<Response>) {
  let response: Response;
  try { response = await handler(); }
  catch { response = Response.json({ error: "Unable to complete this request right now." }, { status: 500 }); }
  if (response.status < 400) return response;
  const record = await recordDiagnostic(operation, response.status);
  // Never return codes, exception messages, stack traces or configuration details.
  if (response.status >= 500) {
    const headers = new Headers({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
    const retry = response.headers.get("retry-after"); if (retry) headers.set("Retry-After", retry);
    return Response.json({ error: "Unable to complete this request right now. Please try again later.", reference: record.reference }, { status: response.status, headers });
  }
  response.headers.set("x-support-reference", record.reference);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
