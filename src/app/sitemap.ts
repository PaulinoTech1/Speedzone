import type { MetadataRoute } from "next";

import { cachedPublishedVehicles } from "@/lib/server/public-inventory";

const origin = "https://www.speedzonems.com";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const vehicles = await cachedPublishedVehicles();
  const publicPages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/inventory`, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/test-drive`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/road-trip`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  return [
    ...publicPages,
    ...vehicles.map((vehicle) => ({
      url: `${origin}/inventory/${vehicle.slug}`,
      lastModified: vehicle.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      images: vehicle.photographs.map((photo) => photo.url),
    })),
  ];
}
