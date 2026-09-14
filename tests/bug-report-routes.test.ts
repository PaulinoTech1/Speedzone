import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ isAdmin: vi.fn(), admit: vi.fn(), store: vi.fn(), read: vi.fn(), body: vi.fn(), validOrigin: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAdmin: mocks.isAdmin, privateResponseHeaders: () => ({ "Cache-Control": "private, no-store" }) }));
vi.mock("@/lib/diagnostics", () => ({ withDiagnostics: async (_operation: string, handler: () => Promise<Response>) => handler(), readDiagnostics: mocks.read, diagnosticOperations: {}, diagnosticDefinition: () => ({}) }));
vi.mock("@/lib/bug-reports", () => ({ admitBugReport: mocks.admit, readReportBody: mocks.body, storeBugReport: mocks.store, validReportOrigin: mocks.validOrigin, validateBugReport: (value: unknown) => value, readBugReports: mocks.read }));
import { GET } from "@/app/api/admin/diagnostics/route";
import { POST } from "@/app/api/bug-reports/route";
const request = () => new Request("https://example.test/api/bug-reports", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
beforeEach(() => { vi.resetAllMocks(); mocks.validOrigin.mockReturnValue(true); mocks.admit.mockResolvedValue(0); mocks.body.mockResolvedValue({ title: "synthetic" }); mocks.store.mockResolvedValue("receipt"); });
it.each(["anonymous", "setup", "expired"])("denies %s callers before reading report or diagnostic data", async () => {
  mocks.isAdmin.mockResolvedValue(false); expect((await GET()).status).toBe(401); expect(mocks.read).not.toHaveBeenCalled();
});
it("permits full passkey admins and prevents caching", async () => {
  mocks.isAdmin.mockResolvedValue(true); mocks.read.mockResolvedValue([]);
  const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
});
it("rejects excessive attempts before reading or storing the body", async () => {
  mocks.admit.mockResolvedValue(3600); const response = await POST(request());
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("3600"); expect(mocks.body).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
});
it("fails closed on limiter outage", async () => {
  mocks.admit.mockRejectedValue(new Error("offline")); expect((await POST(request())).status).toBe(503); expect(mocks.store).not.toHaveBeenCalled();
});
it("stores an admitted valid report and returns only an opaque receipt", async () => {
  const response = await POST(request()); expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true, reference: "receipt" });
});
