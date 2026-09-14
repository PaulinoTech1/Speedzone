import { createHash } from "node:crypto";
import type { SecurityEvent } from "@/lib/security-console/security-store";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function eventHashIsValid(event: SecurityEvent) {
  return /^[0-9a-f]{64}$/i.test(event.hash) && createHash("sha256").update(canonical(event)).digest("hex") === event.hash;
}

export function eventGroups(events: SecurityEvent[]) {
  const adminAccess = events.filter(event => event.event === "admin.login" || event.event === "admin.login.rate_limited" || event.event === "admin.logout" || event.event === "admin.session.created" || event.event === "admin.passkey");
  const credentials = events.filter(event => event.event === "admin.password.changed" || event.event === "admin.recovery" || event.event === "admin.passkey");
  return {
    adminAccess,
    credentials,
    inventory: events.filter(event => event.event.startsWith("inventory.")),
    reports: events.filter(event => event.event.startsWith("bug-report.")),
    customers: events.filter(event => event.event.startsWith("test-drive.")),
  };
}

export function dashboardSummary(events: SecurityEvent[]) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter(event => Date.parse(event.occurredAt) >= since);
  const networks = new Map<string, number>();
  for (const event of events) if (event.client?.networkFingerprint) networks.set(event.client.networkFingerprint, (networks.get(event.client.networkFingerprint) || 0) + 1);
  const invalidHashes = events.filter(event => !eventHashIsValid(event)).length;
  const unsupportedVersions = events.filter(event => event.version !== 1 && event.version !== 2).length;
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  let largestGapMs = 0;
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (current && previous) largestGapMs = Math.max(largestGapMs, Date.parse(current.occurredAt) - Date.parse(previous.occurredAt));
  }
  return {
    successfulLogins: recent.filter(event => event.event === "admin.login" && event.outcome === "allowed").length,
    failedLogins: recent.filter(event => event.event === "admin.login" && event.outcome !== "allowed").length,
    operationalFailures: recent.filter(event => ["failed", "unavailable"].includes(event.outcome)).length,
    reports: recent.filter(event => event.event === "bug-report.submission").length,
    inventoryMutations: recent.filter(event => event.event === "inventory.mutation" && event.outcome === "allowed").length,
    newNetworks: [...networks.values()].filter(count => count === 1).length,
    invalidHashes,
    unsupportedVersions,
    largestGapMs,
    lastReceivedAt: events[0]?.occurredAt,
  };
}

export function configurationHealth() {
  return [
    ["SECURITY_LOG_PROVIDER", process.env.SECURITY_LOG_PROVIDER],
    ["SECURITY_LOG_QUERY_URL", process.env.SECURITY_LOG_QUERY_URL],
    ["SECURITY_LOG_QUERY_TOKEN", process.env.SECURITY_LOG_QUERY_TOKEN],
    ["SECURITY_CONSOLE_IP_HASH_SECRET", process.env.SECURITY_CONSOLE_IP_HASH_SECRET || process.env.SECURITY_IP_HASH_SECRET],
    ["ADMIN_SECURITY_KV_REST_API_URL", process.env.ADMIN_SECURITY_KV_REST_API_URL || process.env.SECURITY_KV_REST_API_URL],
    ["ADMIN_SECURITY_KV_REST_API_TOKEN", process.env.ADMIN_SECURITY_KV_REST_API_TOKEN || process.env.SECURITY_KV_REST_API_TOKEN],
    ["EMBEDDED_SECURITY_WEBAUTHN_ORIGIN", process.env.EMBEDDED_SECURITY_WEBAUTHN_ORIGIN],
    ["EMBEDDED_SECURITY_WEBAUTHN_RP_ID", process.env.EMBEDDED_SECURITY_WEBAUTHN_RP_ID],
    ["SECURITY_TEST_TARGET_URL", process.env.SECURITY_TEST_TARGET_URL],
    ["SECURITY_CONSOLE_TEST_SECRET", process.env.SECURITY_CONSOLE_TEST_SECRET],
    ["BUG_REPORT_ENCRYPTION_KEY", process.env.BUG_REPORT_ENCRYPTION_KEY],
  ].map(([key, value]) => ({ key, status: value?.trim() ? "SET" as const : "MISSING" as const }));
}
