import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { dashboardSummary, eventGroups, eventHashIsValid } from "@/lib/security-console/dashboard";
import { isSecurityEvent, parseProviderEvents, type SecurityEvent } from "@/lib/security-console/security-store";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function event(input: Partial<SecurityEvent>): SecurityEvent {
  const value = { version: 2, id: crypto.randomUUID(), occurredAt: new Date().toISOString(), event: "admin.login", outcome: "allowed", actor: "admin", route: "/api/admin/login", method: "POST", requestId: "req_12345678", client: { networkFingerprint: "abc" }, ...input } as Omit<SecurityEvent, "hash">;
  return { ...value, hash: createHash("sha256").update(canonical(value)).digest("hex") };
}

describe("embedded security dashboard", () => {
  it("groups operations and summarizes recent events", () => {
    const valid = event({});
    const failed = event({ event: "test-drive.notification", outcome: "failed" });
    const inventory = event({ event: "inventory.mutation" });
    const groups = eventGroups([valid, failed, inventory]);
    const summary = dashboardSummary([valid, failed, inventory]);

    expect(groups.adminAccess).toHaveLength(1);
    expect(groups.customers).toHaveLength(1);
    expect(groups.inventory).toHaveLength(1);
    expect(summary.successfulLogins).toBe(1);
    expect(summary.operationalFailures).toBe(1);
    expect(summary.invalidHashes).toBe(0);
    expect(eventHashIsValid(valid)).toBe(true);
  });

  it("unwraps provider rows and rejects malformed events", () => {
    const valid = event({});
    expect(parseProviderEvents({ matches: [{ data: valid }, { data: { id: "bad" } }] })).toEqual([valid]);
    expect(isSecurityEvent({ ...valid, hash: undefined })).toBe(false);
  });
});
