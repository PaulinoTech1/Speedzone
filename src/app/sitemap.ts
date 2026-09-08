import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/inventory", "/test-drive", "/sell-your-car", "/buying-costs", "/recall-check", "/road-trip", "/privacy", "/terms"].map(path => ({
    url: `https://www.speedzonems.com${path || "/"}`,
    changeFrequency: "monthly",
    priority: path ? 0.5 : 1,
  }));
}
