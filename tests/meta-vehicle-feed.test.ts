import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), event: vi.fn(), blocked: vi.fn(), fail: vi.fn() }));
vi.mock("@/lib/integration-rate-limit", () => ({ networkKey: () => "net", feedFailuresBlocked: mocks.blocked, recordFeedFailure: mocks.fail }));
vi.mock("@/lib/inventory", async original => ({ ...(await original<typeof import("@/lib/inventory")>()), readInventory: mocks.read }));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: mocks.event }));
import { GET } from "@/app/api/feeds/meta-vehicles/route";
import { buildVehicleFeedCsv, feedColumns, feedRows, feedTokenMatches } from "@/lib/integrations/meta/vehicle-feed";
import type { Vehicle } from "@/lib/inventory";

// Every cell is quoted by the builder, so a quoted-cell splitter is enough here.
const parseCsv = (csv: string) => csv.trim().split("\r\n").map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1]!.replace(/""/g, '"')));
const token = "t".repeat(40);
const photo = "https://store.public.blob.vercel-storage.com/inventory/a.webp";
const car = (overrides: Partial<Vehicle> = {}): Vehicle => ({ id: "11111111-1111-4111-8111-111111111111", vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", bodyStyle: "Sedan", exteriorColor: "Silver", transmission: "CVT", drivetrain: "4WD", fuelType: "Plug-in Hybrid", price: 18995, mileage: 48210.4, condition: "Used", description: "Clean", status: "available", photos: [photo], createdAt: "2026-10-01T00:00:00.000Z", ...overrides });
const req = (headers: Record<string, string> = {}, query = "") => new Request(`https://www.speedzonems.com/api/feeds/meta-vehicles${query}`, { headers });
const basic = (password: string) => ({ authorization: `Basic ${Buffer.from(`meta:${password}`).toString("base64")}` });

describe("Meta vehicle feed mapping", () => {
  it("maps listings to Meta Vehicle enum values", () => {
    const [row] = feedRows([car()]);
    expect(row).toMatchObject({ vehicle_id: "1HGCM82633A004352", "mileage.value": "48210", "mileage.unit": "MI", body_style: "SEDAN", transmission: "AUTOMATIC", drivetrain: "FOUR_WD", fuel_type: "PLUGIN_HYBRID", state_of_vehicle: "USED", vehicle_type: "CAR_TRUCK", price: "18995.00 USD", availability: "AVAILABLE", url: "https://www.speedzonems.com/inventory/11111111-1111-4111-8111-111111111111", "image[0].url": photo });
  });
  it("excludes sold and photo-less listings, maps pending, falls back to id without VIN", () => {
    const rows = feedRows([car({ status: "sold" }), car({ photos: [] }), car({ status: "pending", vin: "", bodyStyle: undefined })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ availability: "PENDING", vehicle_id: "11111111-1111-4111-8111-111111111111", body_style: "OTHER" });
  });
  it("emits a parseable CSV with a fixed header and neutralized formulas", () => {
    const rows = parseCsv(buildVehicleFeedCsv([car({ description: '=HYPERLINK("x")\nline "two"' })]));
    expect(rows[0]).toEqual([...feedColumns]);
    expect(rows[1]![feedColumns.indexOf("description")]).toBe(' =HYPERLINK("x") line "two"');
  });
  it("contains only public listing and dealership fields", () => {
    expect(feedColumns.some(column => /email|customer|cost|buyer|note/i.test(column))).toBe(false);
  });
  it("compares tokens in constant time without throwing on length mismatch", () => {
    expect(feedTokenMatches(token, token)).toBe(true);
    expect(feedTokenMatches("short", token)).toBe(false);
    expect(feedTokenMatches(null, token)).toBe(false);
  });
});

describe("feed route", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue([car()]); mocks.blocked.mockResolvedValue({ blocked: false, retryAfter: 0 }); });
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled (404) when the token is unset or too short", async () => {
    expect((await GET(req(basic(token)))).status).toBe(404);
    vi.stubEnv("META_FEED_TOKEN", "short");
    expect((await GET(req(basic("short")))).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects missing or wrong tokens without reading inventory", async () => {
    vi.stubEnv("META_FEED_TOKEN", token);
    for (const response of [await GET(req()), await GET(req(basic("x".repeat(40)))), await GET(req({}, "?token=nope"))]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    }
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain("nope");
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", reason: "catalog_feed_token_rejected" }));
  });
  it("ignores a correct token in the query string (it would land in request logs)", async () => {
    vi.stubEnv("META_FEED_TOKEN", token);
    expect((await GET(req({}, `?token=${token}`))).status).toBe(401);
  });
  it("blocks a network after repeated failures before checking the token or reading data", async () => {
    vi.stubEnv("META_FEED_TOKEN", token);
    mocks.blocked.mockResolvedValue({ blocked: true, retryAfter: 120 });
    const response = await GET(req(basic(token)));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("serves CSV via Basic auth or Bearer with CDN-proof no-store caching", async () => {
    vi.stubEnv("META_FEED_TOKEN", token);
    for (const request of [req(basic(token)), req({ authorization: `Bearer ${token}` })]) {
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
      expect(response.headers.get("vary")).toBe("Authorization");
      expect(await response.text()).toContain("1HGCM82633A004352");
    }
  });
  it("returns 503 when inventory is unavailable", async () => {
    vi.stubEnv("META_FEED_TOKEN", token);
    mocks.read.mockRejectedValue(new Error("down"));
    expect((await GET(req(basic(token)))).status).toBe(503);
  });
});
