import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const imageProject = process.env.SANITY_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
const imageDataset = process.env.SANITY_DATASET?.trim() || process.env.NEXT_PUBLIC_SANITY_DATASET?.trim();
const imagePath = imageProject && /^[a-z0-9]+$/.test(imageProject)
  && imageDataset && /^[a-z0-9_-]+$/.test(imageDataset)
  ? `/images/${imageProject}/${imageDataset}/**` : undefined;

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
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

const noStoreHeaders = [
  ...securityHeaders,
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["argon2"],
  images: {
    // Images are already normalized WebP. Disabling the public decoder closes
    // the vulnerable AVIF path while the dependency upgrade is pending.
    unoptimized: true,
    maximumRedirects: 0,
    remotePatterns: imagePath ? [{ protocol: "https", hostname: "cdn.sanity.io", pathname: imagePath }] : [],
  },
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
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: noStoreHeaders },
      { source: "/api/admin/:path*", headers: noStoreHeaders },
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
