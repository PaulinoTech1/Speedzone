import type { MetadataRoute } from "next";

// Named explicitly (rather than left to the "*" default) so this site's
// intent to be readable and citable by AI assistants is unambiguous, and
// survives a future blanket rule added for an unrelated bot. Deprecated
// Anthropic agents (Claude-Web, anthropic-ai) are intentionally omitted.
const aiAssistantCrawlers = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      ...aiAssistantCrawlers.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: ["/admin", "/api/"],
      })),
    ],
    sitemap: "https://www.speedzonems.com/sitemap.xml",
    host: "https://www.speedzonems.com",
  };
}
