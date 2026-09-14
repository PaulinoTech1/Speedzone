import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { dashboardSummary, eventGroups, eventHashIsValid } from "@/lib/dashboard";
import type { SecurityEvent } from "@/lib/security-store";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
function event(input: Partial<SecurityEvent>): SecurityEvent {
  const value={version:2,id:crypto.randomUUID(),occurredAt:new Date().toISOString(),event:"admin.login",outcome:"allowed",actor:"admin",route:"/api/admin/login",method:"POST",requestId:"req_12345678",client:{networkFingerprint:"abc"},...input} as Omit<SecurityEvent,"hash">;
  return {...value,hash:createHash("sha256").update(canonical(value)).digest("hex")};
}
describe("security dashboard",()=>{
  it("groups operational events without exposing unrelated categories",()=>{const events=[event({event:"admin.login"}),event({event:"inventory.mutation"}),event({event:"bug-report.submission"})];const groups=eventGroups(events);expect(groups.adminAccess).toHaveLength(1);expect(groups.inventory).toHaveLength(1);expect(groups.reports).toHaveLength(1)});
  it("summarizes recent visible data and validates integrity",()=>{const valid=event({});const invalid={...event({event:"test-drive.notification",outcome:"failed"}),reason:"tampered"};const summary=dashboardSummary([valid,invalid]);expect(summary.successfulLogins).toBe(1);expect(summary.operationalFailures).toBe(1);expect(summary.invalidHashes).toBe(1);expect(eventHashIsValid(valid)).toBe(true)});
});
