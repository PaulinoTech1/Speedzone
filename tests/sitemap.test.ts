import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/inventory", async original => ({ ...(await original<typeof import("@/lib/inventory")>()), readInventory: mocks.read }));
import sitemap from "@/app/sitemap";

const car = (id: string, status: "available" | "pending" | "sold") => ({ id, year: 2020, make: "Honda", model: "Fit", price: 1, mileage: 1, condition: "Used", description: "", status, photos: [], createdAt: "2026-10-01T00:00:00.000Z" });
beforeEach(() => vi.resetAllMocks());

it("lists available and pending vehicle pages and excludes sold ones", async () => {
  mocks.read.mockResolvedValue([car("a", "available"), car("b", "pending"), car("c", "sold")]);
  const urls = (await sitemap()).map(entry => entry.url);
  expect(urls).toContain("https://www.speedzonems.com/inventory/a");
  expect(urls).toContain("https://www.speedzonems.com/inventory/b");
  expect(urls).not.toContain("https://www.speedzonems.com/inventory/c");
  expect(urls).toContain("https://www.speedzonems.com/inventory");
  expect(urls).toContain("https://www.speedzonems.com/sitemap");
});

it("falls back to static pages when inventory is unavailable", async () => {
  mocks.read.mockRejectedValue(new Error("down"));
  const urls = (await sitemap()).map(entry => entry.url);
  expect(urls).toHaveLength(10);
  expect(urls.some(url => url.includes("/inventory/"))).toBe(false);
});
