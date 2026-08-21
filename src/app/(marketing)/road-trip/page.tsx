import type { Metadata } from "next";

import { RoadTripContent } from "@/components/public/RoadTripContent";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";

export const metadata: Metadata = {
  title: "Road Trip",
  description:
    "Discover free and low-cost family road trips from Worcester to Central Massachusetts and the Boston area, with current prices and official planning links.",
  alternates: { canonical: "/road-trip" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/road-trip",
    title: "Road Trip | SpeedZone Motorsports",
    description:
      "Free and low-cost family day trips from Worcester to Central Massachusetts and the Boston area.",
  },
  twitter: {
    card: "summary",
    title: "Road Trip | SpeedZone Motorsports",
    description:
      "Free and low-cost family day trips from Worcester, Massachusetts.",
  },
};

export default function RoadTripPage() {
  return (
    <>
      <SiteHeader currentPage="road-trip" />
      <RoadTripContent />
      <SiteFooter currentPage="road-trip" />
    </>
  );
}
