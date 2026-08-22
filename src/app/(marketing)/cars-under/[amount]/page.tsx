import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { VehicleCard } from "@/components/public/VehicleCard";
import { formatBracket, parsePriceBracket, priceBrackets } from "@/lib/domain/price-brackets";
import { cachedPublishedVehicles } from "@/lib/server/public-inventory";

type PageProps = { params: Promise<{ amount: string }> };

export function generateStaticParams() {
  return priceBrackets.map((amount) => ({ amount: String(amount) }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { amount } = await params;
  const bracket = parsePriceBracket(amount);
  if (!bracket) return { title: "Not found", robots: { index: false, follow: false } };

  const label = formatBracket(bracket);
  const vehicles = await cachedPublishedVehicles();
  const matching = vehicles.filter((vehicle) => vehicle.price <= bracket);

  const title = `Used Cars Under ${label} in Worcester, MA`;
  const description = `Browse used cars under ${label} at SpeedZone Motorsports in Worcester, Massachusetts. Quality-inspected vehicles, no-pressure sales.`;

  return {
    title,
    description,
    alternates: { canonical: `/cars-under/${bracket}` },
    // An empty bracket is thin content, so keep it out of the index until it
    // has something to show. It stays reachable and crawlable for its links.
    robots: matching.length > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: `/cars-under/${bracket}`,
      title: `${title} | SpeedZone Motorsports`,
      description,
      images: [
        { url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" },
      ],
    },
    twitter: {
      card: "summary",
      title: `${title} | SpeedZone Motorsports`,
      description,
      images: ["/assets/speedzone-logo-v1.png"],
    },
  };
}

export default async function CarsUnderPage({ params }: PageProps) {
  const { amount } = await params;
  const bracket = parsePriceBracket(amount);
  if (!bracket) notFound();

  const label = formatBracket(bracket);
  const vehicles = await cachedPublishedVehicles();
  const matching = vehicles
    .filter((vehicle) => vehicle.price <= bracket)
    .sort((left, right) => left.price - right.price);

  return (
    <>
      <SiteHeader currentPage="inventory" />
      <main id="main" className="inventory-page">
        <section className="inventory-hero">
          <div className="shell">
            <p className="section-kicker">Shop by budget</p>
            <h1>Used cars under {label}</h1>
            <p>
              Every vehicle here is currently published by SpeedZone Motorsports in Worcester and
              priced at or below {label}. Inventory moves quickly, so call before making the trip.
            </p>
          </div>
        </section>

        <section className="section" aria-labelledby="bracket-results-title">
          <div className="shell">
            <nav className="bracket-nav" aria-label="Browse by price">
              {priceBrackets.map((value) => (
                <Link
                  key={value}
                  href={`/cars-under/${value}`}
                  aria-current={value === bracket ? "page" : undefined}
                >
                  Under {formatBracket(value)}
                </Link>
              ))}
              <Link href="/inventory">All vehicles</Link>
            </nav>

            <div className="inventory-results-heading">
              <h2 id="bracket-results-title">
                {matching.length} {matching.length === 1 ? "vehicle" : "vehicles"} under {label}
              </h2>
              <a href="tel:+15088269405">Call (508) 826-9405</a>
            </div>

            {matching.length ? (
              <div className="vehicle-grid">
                {matching.map((vehicle) => (
                  <VehicleCard vehicle={vehicle} key={vehicle.id} />
                ))}
              </div>
            ) : (
              <div className="inventory-empty">
                <h2>Nothing under {label} right now.</h2>
                <p>
                  Our stock changes often. Tell us your budget and what you need, and we will let
                  you know when something fits.
                </p>
                <a className="button button-primary" href="tel:+15088269405">
                  Tell us your budget
                </a>
              </div>
            )}

            <p className="bracket-footnote">
              Prices shown do not include Massachusetts tax, title, registration, or inspection.
              See <Link href="/buying-costs">what a used car really costs</Link> to estimate your
              total.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter currentPage="inventory" />
    </>
  );
}
