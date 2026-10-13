import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ put: vi.fn(), redisGet: vi.fn(), eval: vi.fn() }));
vi.mock("@vercel/blob", async original => ({ ...await original<typeof import("@vercel/blob")>(), put: store.put }));
vi.mock("@/lib/redis", () => ({ getRedis: () => ({ get: store.redisGet, eval: store.eval }) }));
vi.mock("@/lib/diagnostics", () => ({ withDiagnostics: (_op: string, fn: () => Promise<Response>) => fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAdminAuthenticated: async () => true }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: async () => {} }));
import { PATCH } from "@/app/api/inventory/route";

const details = { stockNumber: "SZ-104", trim: "EX", bodyStyle: "Sedan", exteriorColor: "Silver", interiorColor: "Black", transmission: "CVT", drivetrain: "FWD", fuelType: "Gasoline" } as const;
const vehicle = { id: "one", vin: "1HGCM82633A004352", year: 2022, make: "Honda", model: "Civic", price: 100, mileage: 1, condition: "Used", description: "", status: "available" as const, photos: [], createdAt: "2026-01-01", ...details };
const patch = (body: unknown) => new Request("https://example.com/api/inventory", { method: "PATCH", headers: { "if-match": "v1", origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify(body) });
const committed = () => JSON.parse(store.eval.mock.calls[0]![2][1]).vehicles[0];

beforeEach(() => {
  vi.resetAllMocks();
  store.redisGet.mockResolvedValue({ version: 2, revision: "v1", vehicles: [vehicle] });
  store.put.mockResolvedValue({}); store.eval.mockResolvedValue(1);
});

it("keeps every existing listing detail and the VIN when an edit omits them", async () => {
  const response = await PATCH(patch({ id: "one", year: 2022, make: "Honda", model: "Civic", price: 95, mileage: 2 }));
  expect(response.status).toBe(200);
  expect(committed()).toMatchObject({ ...details, vin: vehicle.vin, price: 95 });
});

it("clears only the details an edit explicitly blanks", async () => {
  await PATCH(patch({ id: "one", year: 2022, make: "Honda", model: "Civic", price: 100, mileage: 1, trim: "", bodyStyle: "Coupe" }));
  const saved = committed();
  expect(saved).not.toHaveProperty("trim");
  expect(saved).toMatchObject({ bodyStyle: "Coupe", stockNumber: "SZ-104", exteriorColor: "Silver" });
});
