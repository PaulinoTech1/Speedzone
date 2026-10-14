import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const isProduction = process.env.NODE_ENV === "production";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true, remotePatterns: [] },
  async redirects() {
    return [
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/road-trip.html", destination: "/road-trip", permanent: true },
      { source: "/privacy.html", destination: "/privacy", permanent: true },
      { source: "/terms.html", destination: "/terms", permanent: true },
    ];
  },
  async headers() {
    return [
      // BotID serves its challenge frame from this path and sets SAMEORIGIN itself.
      { source: "/((?!149e9513-01fa-4fb0-aad4-566afd725d1b/).*)", headers: securityHeaders },
      { source: "/149e9513-01fa-4fb0-aad4-566afd725d1b/:path*", headers: securityHeaders.filter((header) => header.key !== "X-Frame-Options") },
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default withBotId(nextConfig);
