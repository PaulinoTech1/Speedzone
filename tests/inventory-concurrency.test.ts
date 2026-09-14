import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", async (original) => ({ ...await original<typeof import("@vercel/blob")>(), get: store.get, put: store.put, del: store.del }));
vi.mock("@/lib/admin-auth", () => ({ isAdminAuthenticated: async () => true }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: async () => {}, auditRoute: async (_request: Request, _event: string, handler: () => Promise<Response>) => handler() }));
import { BlobPreconditionFailedError } from "@vercel/blob";
import { readInventorySnapshot, writeInventory } from "@/lib/inventory";
import { DELETE, PATCH } from "@/app/api/inventory/route";
const vehicle = { id: "one", year: 2022, make: "Honda", model: "Civic", price: 100, mileage: 1, condition: "Used", description: "", status: "available" as const, photos: [], createdAt: "2026-01-01" };
beforeEach(() => { vi.resetAllMocks(); store.get.mockImplementation(async () => ({ statusCode: 200, blob: { etag: "v1" }, stream: new Response(JSON.stringify([vehicle])).body })); });
it("permits only one of two writers using the same snapshot", async () => {
  let current = "v1";
  store.put.mockImplementation(async (_path, _body, options) => { if (options.ifMatch !== current) throw new BlobPreconditionFailedError(); current = "v2"; return { etag: current }; });
  const [a, b] = await Promise.all([readInventorySnapshot(), readInventorySnapshot()]);
  const results = await Promise.allSettled([writeInventory(a.vehicles, a.revision), writeInventory(b.vehicles, b.revision)]);
  expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(store.get).toHaveBeenCalledWith("inventory/inventory.json", { access: "public" });
});
it("rejects stale browser edits before writing", async () => {
  const response = await PATCH(new Request("https://example.com/api/inventory", { method: "PATCH", headers: { "if-match": "old" }, body: JSON.stringify(vehicle) }));
  expect(response.status).toBe(409); expect(store.put).not.toHaveBeenCalled();
});
it("retains photo objects when catalog deletion fails", async () => {
  store.put.mockRejectedValue(new Error("storage down"));
  const response = await DELETE(new Request("https://example.com/api/inventory", { method: "DELETE", headers: { "if-match": "v1" }, body: JSON.stringify({ id: "one" }) }));
  expect(response.ok).toBe(false); expect(store.del).not.toHaveBeenCalled();
});
it("creates an absent catalog without allowing overwrite", async () => {
  await writeInventory([vehicle], "absent");
  expect(store.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ allowOverwrite: false }));
});
