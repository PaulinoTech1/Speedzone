import type { MetadataRoute } from "next";
import { readInventory, vehiclePath, type Vehicle } from "@/lib/inventory";

// Rendered per request so new listings appear without a redeploy.
export const dynamic = "force-dynamic";

const origin = "https://www.speedzonems.com";
const staticPaths = ["", "/inventory", "/test-drive", "/sell-your-car", "/buying-costs", "/recall-check", "/road-trip", "/privacy", "/terms"];

/** Sold listings keep their URL but are noindex, so they are left out. */
export function vehicleSitemapEntries(vehicles: Vehicle[]): MetadataRoute.Sitemap {
  return vehicles.filter(vehicle => vehicle.status !== "sold").map(vehicle => ({
    url: `${origin}${vehiclePath(vehicle)}`,
    lastModified: vehicle.createdAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = staticPaths.map(path => ({
    url: `${origin}${path || "/"}`,
    changeFrequency: "monthly",
    priority: path ? 0.5 : 1,
  }));
  let vehicles: Vehicle[] = [];
  // Inventory storage problems must not take the sitemap down.
  try { vehicles = await readInventory(); } catch { /* static pages only */ }
  return [...pages, ...vehicleSitemapEntries(vehicles)];
}
