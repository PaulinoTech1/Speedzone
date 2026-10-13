import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isAdmin: vi.fn(), read: vi.fn(), write: vi.fn(), event: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/integration-rate-limit", () => ({ limitInventoryImport: mocks.limit }));
vi.mock("@/lib/admin-auth", () => ({ isAdmin: mocks.isAdmin, privateResponseHeaders: () => ({ "Cache-Control": "private, no-store, max-age=0" }) }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: mocks.event }));
vi.mock("@/lib/diagnostics", () => ({ withDiagnostics: (_: string, handler: () => Promise<Response>) => handler() }));
vi.mock("@/lib/inventory", async original => ({ ...(await original<typeof import("@/lib/inventory")>()), readInventorySnapshot: mocks.read, writeInventory: mocks.write }));

import { POST } from "@/app/api/admin/inventory-import/route";

const csv = readFileSync(new URL("./fixtures/dealercenter-sample.synthetic.csv", import.meta.url), "utf8");
const origin = "https://speedzone.example";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/admin/inventory-import`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

describe("admin inventory import route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isAdmin.mockResolvedValue(true);
    mocks.read.mockResolvedValue({ vehicles: [], revision: "rev-1" });
    mocks.write.mockResolvedValue({ etag: "rev-2" });
    mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  });

  it("rate limits import requests and fails closed when the limiter is unavailable", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const response = await POST(request({ csv, mode: "preview" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("checks authentication before the limiter, so anonymous callers cannot exhaust it", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    await POST(request({ csv, mode: "preview" }));
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("requires a passkey session and audits the denial", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    expect((await POST(request({ csv, mode: "preview" }))).status).toBe(401);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", reason: "authentication_required" }));
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests", async () => {
    expect((await POST(request({ csv, mode: "preview" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request({ csv, mode: "preview" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });

  it("previews without writing, then applies only the previewed digest and revision", async () => {
    const preview = await POST(request({ csv, mode: "preview" }));
    const { diff, revision } = await preview.json();
    expect(diff.added).toHaveLength(3);
    expect(mocks.write).not.toHaveBeenCalled();
    expect((await POST(request({ csv, mode: "apply", digest: "stale" }, { "if-match": revision }))).status).toBe(409);
    expect((await POST(request({ csv, mode: "apply", digest: diff.digest }, { "if-match": "old" }))).status).toBe(409);
    const applied = await POST(request({ csv, mode: "apply", digest: diff.digest }, { "if-match": revision }));
    expect(applied.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ reason: "import_applied", metadata: expect.objectContaining({ added: 3, blocked_columns: 4 }) }));
    expect(JSON.stringify(mocks.event.mock.calls)).not.toMatch(/Jane|555-0100/);
  });

  it("refuses to apply when rows have errors", async () => {
    const bad = "VIN,Year,Make,Model,Price,Mileage\nBADVIN,2019,Honda,Accord,1,10";
    const { diff } = await (await POST(request({ csv: bad, mode: "preview" }))).json();
    expect((await POST(request({ csv: bad, mode: "apply", digest: diff.digest }, { "if-match": "rev-1" }))).status).toBe(422);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, oversize and malformed requests", async () => {
    expect((await POST(new Request(`${origin}/api/admin/inventory-import`, { method: "POST", headers: { origin, "content-type": "text/csv" }, body: csv }))).status).toBe(415);
    expect((await POST(request({ csv: "x".repeat(1200 * 1024), mode: "preview" }))).status).toBe(413);
    expect((await POST(request({ csv, mode: "delete" }))).status).toBe(400);
    expect((await POST(request({ csv: "VIN,Make\n1,2", mode: "preview" }))).status).toBe(400);
  });
});
