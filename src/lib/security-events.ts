import { createHash, randomUUID } from "node:crypto";

export type SecurityEventOutcome = "allowed" | "denied" | "failed" | "unavailable";
export type SecurityEventName =
  | "admin.logout"
  | "admin.login"
  | "admin.passkey"
  | "admin.recovery"
  | "inventory.read"
  | "inventory.mutation"
  | "inventory.upload"
  | "test-drive.submission";

export type SecurityEvent = {
  version: 1;
  id: string;
  requestId: string;
  occurredAt: string;
  event: SecurityEventName;
  outcome: SecurityEventOutcome;
  actor: "anonymous" | "admin" | "setup";
  route: string;
  method: string;
  status?: number;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
  previousHash?: string;
  hash: string;
};

const prohibited = /password|token|secret|assertion|credential|cookie|email|phone|name|address|vehicle|photo|blob|authorization/i;
const safeKey = /^[a-z][a-zA-Z0-9_]{0,31}$/;

export function requestId(value?: string | null) {
  return value && /^[A-Za-z0-9._-]{8,96}$/.test(value) ? value : `req_${randomUUID()}`;
}

export function sanitizeMetadata(input: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!safeKey.test(key) || prohibited.test(key)) continue;
    if (typeof value === "string" && value.length <= 160) output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean" || value === null) output[key] = value;
  }
  return Object.keys(output).length ? output : undefined;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function hashSecurityEvent(event: Omit<SecurityEvent, "hash">) {
  return createHash("sha256").update(canonical(event)).digest("hex");
}

export function createSecurityEvent(input: Omit<SecurityEvent, "version" | "id" | "occurredAt" | "hash"> & { requestId?: string }) {
  const event = { version: 1 as const, id: randomUUID(), occurredAt: new Date().toISOString(), ...input, requestId: requestId(input.requestId), metadata: sanitizeMetadata(input.metadata) };
  return { ...event, hash: hashSecurityEvent(event) };
}

export function verifySecurityEvent(event: SecurityEvent) {
  return event.version === 1 && event.hash === hashSecurityEvent(event);
}

export async function writeSecurityEvent(input: Parameters<typeof createSecurityEvent>[0]) {
  const event = createSecurityEvent(input);
  await deliverSecurityEvent(event);
  return event;
}

export async function deliverSecurityEvent(event: SecurityEvent) {
  const provider = process.env.SECURITY_LOG_PROVIDER;
  if (!provider || provider === "disabled") return { delivered: false as const, status: null, reason: "disabled" as const };
  if (provider === "axiom") {
    const endpoint = process.env.SECURITY_LOG_INGEST_URL;
    const token = process.env.SECURITY_LOG_INGEST_TOKEN;
    if (!endpoint || !token) { console.error("[security] logging configuration incomplete"); return { delivered: false as const, status: null, reason: "incomplete" as const }; }
    try { const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) }); if (!response.ok) console.error("[security] log delivery rejected", response.status); return { delivered: response.ok, status: response.status, reason: response.ok ? null : "rejected" as const }; } catch { console.error("[security] log delivery unavailable"); return { delivered: false as const, status: null, reason: "unavailable" as const }; }
  }
  return { delivered: false as const, status: null, reason: "unsupported" as const };
}

export function securityRequestContext(request: Request) {
  return { requestId: requestId(request.headers.get("x-request-id")), route: new URL(request.url).pathname, method: request.method };
}

export function securityHeaders(requestIdValue: string) {
  return { "x-request-id": requestIdValue, "Cache-Control": "no-store" };
}

export function safeSecurityError(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

export { canonical };

export async function auditRoute(request: Request, event: SecurityEventName, handler: () => Promise<Response>, reason?: string, successActor: SecurityEvent["actor"] = "anonymous") {
  const context = securityRequestContext(request);
  try {
    const response = await handler();
    await writeSecurityEvent({ ...context, event, actor: response.ok ? successActor : "anonymous", status: response.status, outcome: response.ok ? "allowed" : response.status >= 500 ? "failed" : "denied", reason });
    return response;
  } catch (error) {
    await writeSecurityEvent({ ...context, event, actor: "anonymous", status: 500, outcome: "failed", reason });
    throw error;
  }
}
