import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/inventory", async original => ({ ...(await original<typeof import("@/lib/inventory")>()), readInventory: mocks.read }));
import SitemapPage from "@/app/(marketing)/sitemap/page";

const car = (id: string, status: "available" | "pending" | "sold") => ({ id, year: 2020, make: "Honda", model: "Fit", price: 12999, mileage: 45000, condition: "Used", description: "", status, photos: [], createdAt: "2026-10-01T00:00:00.000Z" });
beforeEach(() => vi.resetAllMocks());

it("lists the public pages and available vehicles, and links to the XML sitemap", async () => {
  mocks.read.mockResolvedValue([car("a", "available"), car("b", "pending"), car("c", "sold")]);
  const html = renderToStaticMarkup(await SitemapPage());
  expect(html).toContain("Sitemap");
  expect(html).toContain('href="/inventory"');
  expect(html).toContain('href="/test-drive"');
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/sitemap.xml"');
  expect(html).toContain('href="/inventory/a"');
  expect(html).toContain("2020 Honda Fit");
  expect(html).toContain("$12,999");
  expect(html).toContain('href="/inventory/b"');
  expect(html).not.toContain("/inventory/c");
});

it("falls back to static pages when inventory is unavailable", async () => {
  mocks.read.mockRejectedValue(new Error("down"));
  const html = renderToStaticMarkup(await SitemapPage());
  expect(html).toContain('href="/inventory"');
  expect(html).toContain("No vehicles are listed right now");
  expect(html).not.toContain("/inventory/a");
});
