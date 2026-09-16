import { afterEach, expect, it, vi } from "vitest";
import { auditRoute } from "@/lib/security-events";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("reports provider failures without changing an accepted operation", async () => {
 vi.stubEnv("SECURITY_LOG_PROVIDER", "axiom"); vi.stubEnv("SECURITY_LOG_INGEST_URL", "https://logs.example.test"); vi.stubEnv("SECURITY_LOG_INGEST_TOKEN", "test-secret");
 const transport = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", transport);
 const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
 const response = await auditRoute(new Request("https://example.test/api/inventory", { method: "PATCH", body: "customer private data" }), "inventory.mutation", async () => new Response("ok"), "patch");
 expect(response.status).toBe(200); expect(diagnostic).toHaveBeenCalledWith("[security] log delivery rejected", 503);
 expect(transport.mock.calls[0]?.[1].body).not.toContain("customer private data");
 expect(JSON.parse(transport.mock.calls[0]?.[1].body)).toEqual([expect.objectContaining({ reason: "patch", outcome: "allowed", status: 200 })]);
});
