import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { VehicleCard } from "@/components/public/VehicleCard";
import { formatBracket, priceBrackets } from "@/lib/domain/price-brackets";
import { cachedPublishedVehicles } from "@/lib/server/public-inventory";

export const metadata: Metadata = {
  title: "Used Vehicle Inventory",
  description:
    "Browse currently available used cars, SUVs, and trucks at SpeedZone Motorsports in Worcester, Massachusetts.",
  alternates: { canonical: "/inventory" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/inventory",
    title: "Used Vehicle Inventory | SpeedZone Motorsports",
    description: "See currently available vehicles at SpeedZone Motorsports in Worcester.",
    images: [{ url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" }],
  },
};

export default async function InventoryPage() {
  const vehicles = await cachedPublishedVehicles();
  return (
    <>
      <SiteHeader currentPage="inventory" />
      <main id="main" className="inventory-page">
        <section className="inventory-hero">
          <div className="shell">
            <p className="section-kicker">On the lot</p>
            <h1>Current inventory</h1>
            <p>
              Every vehicle shown here is currently published by SpeedZone. Inventory can
              change quickly, so call before making the trip.
            </p>
          </div>
        </section>
        <section className="section" aria-labelledby="inventory-results-title">
          <div className="shell">
            <nav className="bracket-nav" aria-label="Browse by price">
              {priceBrackets.map((value) => (
                <Link key={value} href={`/cars-under/${value}`}>
                  Under {formatBracket(value)}
                </Link>
              ))}
            </nav>

            <div className="inventory-results-heading">
              <h2 id="inventory-results-title">
                {vehicles.length} {vehicles.length === 1 ? "vehicle" : "vehicles"} available
              </h2>
              <a href="tel:+15088269405">Call (508) 826-9405</a>
            </div>
            {vehicles.length ? (
              <div className="vehicle-grid">
                {vehicles.map((vehicle) => (
                  <VehicleCard vehicle={vehicle} key={vehicle.id} />
                ))}
              </div>
            ) : (
              <div className="inventory-empty">
                <h2>New arrivals are on the way.</h2>
                <p>Call us for the latest availability or tell us what you are looking for.</p>
                <a className="button button-primary" href="tel:+15088269405">
                  Ask what is available
                </a>
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter currentPage="inventory" />
    </>
  );
}
