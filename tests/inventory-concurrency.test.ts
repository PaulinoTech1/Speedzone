import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), redisGet: vi.fn(), eval: vi.fn() }));
vi.mock("@vercel/blob", async original => ({ ...await original<typeof import("@vercel/blob")>(), get: store.get, put: store.put, del: store.del }));
vi.mock("@/lib/redis", () => ({ getRedis: () => ({ get: store.redisGet, eval: store.eval }) }));
vi.mock("@/lib/diagnostics", () => ({ withDiagnostics: (_op: string, fn: () => Promise<Response>) => fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAdminAuthenticated: async () => true }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: async () => {} }));
import { BlobPreconditionFailedError } from "@vercel/blob";
import { readInventorySnapshot, normalizeEtag, writeInventory } from "@/lib/inventory";
import { DELETE, PATCH } from "@/app/api/inventory/route";
const vehicle = { id: "one", year: 2022, make: "Honda", model: "Civic", price: 100, mileage: 1, condition: "Used", description: "", status: "available" as const, photos: [], createdAt: "2026-01-01" };
beforeEach(() => {
  vi.resetAllMocks();
  store.redisGet.mockResolvedValue({ version: 2, revision: "v1", vehicles: [vehicle] });
  store.get.mockImplementation(async () => ({ statusCode: 200, blob: { etag: '"old"' }, stream: new Response(JSON.stringify([vehicle])).body }));
  store.put.mockResolvedValue({}); store.eval.mockResolvedValue(1);
});
const request = (method: string, revision: string, body: unknown) => new Request("https://example.com/api/inventory", {
  method, headers: { "if-match": revision, origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify(body),
});
it("permits only one of two writers using the same authoritative snapshot", async () => {
  let current = "v1";
  store.eval.mockImplementation(async (_script, _keys, args) => { if (args[0] !== current) return 0; current = JSON.parse(args[1]).revision; return 1; });
  const [a, b] = await Promise.all([readInventorySnapshot(), readInventorySnapshot()]);
  const results = await Promise.allSettled([writeInventory(a.vehicles, a.revision), writeInventory(b.vehicles, b.revision)]);
  expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(store.get).not.toHaveBeenCalled();
});
it("rejects stale browser edits before storing a backup or commit", async () => {
  expect((await PATCH(request("PATCH", "old", vehicle))).status).toBe(409);
  expect(store.put).not.toHaveBeenCalled(); expect(store.eval).not.toHaveBeenCalled();
});
it("retains photo objects and the old catalog when backup storage fails", async () => {
  store.put.mockRejectedValue(new Error("storage down"));
  expect((await DELETE(request("DELETE", "v1", { id: "one" }))).ok).toBe(false);
  expect(store.del).not.toHaveBeenCalled(); expect(store.eval).not.toHaveBeenCalled();
});
it("serves legacy listings read-only and refuses to auto-import cached data", async () => {
  store.redisGet.mockResolvedValue(null);
  expect(await readInventorySnapshot()).toEqual({ vehicles: [vehicle], revision: "legacy-read-only" });
  await expect(writeInventory([vehicle], "legacy-read-only")).rejects.toThrow("read-only");
  expect(store.put).not.toHaveBeenCalled(); expect(store.eval).not.toHaveBeenCalled();
});
it("accepts a quoted revision and defers physical photo deletion", async () => {
  expect(normalizeEtag('"v1"')).toBe("v1");
  expect((await DELETE(request("DELETE", '\"v1\"', { id: "one" }))).status).toBe(200);
  expect(store.eval).toHaveBeenCalledWith(expect.any(String), expect.any(Array), ["v1", expect.any(String)]);
  expect(store.del).not.toHaveBeenCalled();
});
it("preserves the actual revision conflict type", async () => {
  store.eval.mockResolvedValue(0);
  await expect(writeInventory([vehicle], "v1")).rejects.toBeInstanceOf(BlobPreconditionFailedError);
});
