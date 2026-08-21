import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { cachedPublishedVehicleBySlug } from "@/lib/server/public-inventory";

type PageProps = { params: Promise<{ slug: string }> };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en-US");

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await cachedPublishedVehicleBySlug(slug);
  if (!vehicle) return { title: "Vehicle not found", robots: { index: false, follow: false } };
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
  return {
    title: name,
    description: `${name} with ${number.format(vehicle.mileage)} miles, available at SpeedZone Motorsports in Worcester, MA.`,
    alternates: { canonical: `/inventory/${vehicle.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: `/inventory/${vehicle.slug}`,
      title: `${name} | SpeedZone Motorsports`,
      description: vehicle.description.slice(0, 180),
      images: vehicle.photographs[0]
        ? [{ url: vehicle.photographs[0].url, alt: vehicle.photographs[0].alt || name }]
        : undefined,
    },
  };
}

export default async function VehiclePage({ params }: PageProps) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const vehicle = await cachedPublishedVehicleBySlug(slug);
  if (!vehicle) notFound();

  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
  const details = [
    ["Mileage", `${number.format(vehicle.mileage)} miles`],
    ["Exterior", vehicle.exteriorColor],
    ["Interior", vehicle.interiorColor],
    ["Body style", vehicle.bodyStyle],
    ["Transmission", vehicle.transmission],
    ["Drivetrain", vehicle.drivetrain],
    ["Fuel", vehicle.fuelType],
    ["Engine", vehicle.engine],
    ["VIN", vehicle.vin],
    ["Stock", vehicle.stockNumber],
  ].filter(([, value]) => Boolean(value));
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name,
    url: `https://www.speedzonems.com/inventory/${vehicle.slug}`,
    image: vehicle.photographs.map((photo) => photo.url),
    description: vehicle.description,
    vehicleIdentificationNumber: vehicle.vin,
    mileageFromOdometer: {
      "@type": "QuantitativeValue",
      value: vehicle.mileage,
      unitCode: "SMI",
    },
    offers: {
      "@type": "Offer",
      price: vehicle.price,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      seller: { "@id": "https://www.speedzonems.com/#dealership" },
    },
  }).replaceAll("<", "\\u003c");

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: structuredData }}
      />
      <SiteHeader currentPage="inventory" />
      <main id="main" className="vehicle-page">
        <div className="shell">
          <nav className="vehicle-breadcrumb" aria-label="Breadcrumb">
            <Link href="/inventory">Inventory</Link>
            <span aria-hidden="true">/</span>
            <span>{name}</span>
          </nav>
          <div className="vehicle-detail-layout">
            <section className="vehicle-gallery" aria-label={`${name} photographs`}>
              {vehicle.photographs.map((photo, index) => (
                <figure className={index === 0 ? "vehicle-photo vehicle-photo-primary" : "vehicle-photo"} key={photo.pathname}>
                  <Image
                    src={photo.url}
                    alt={photo.alt || `${name}, photograph ${index + 1}`}
                    width={photo.width}
                    height={photo.height}
                    sizes={index === 0 ? "(min-width: 64rem) 60vw, 100vw" : "(min-width: 64rem) 30vw, 50vw"}
                    priority={index === 0}
                  />
                </figure>
              ))}
            </section>
            <article className="vehicle-detail">
              <p className="section-kicker">Available now</p>
              <h1>{name}</h1>
              <p className="vehicle-price">{usd.format(vehicle.price)}</p>
              <dl className="vehicle-specs">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {vehicle.description ? (
                <section className="vehicle-description">
                  <h2>About this vehicle</h2>
                  <p>{vehicle.description}</p>
                </section>
              ) : null}
              {vehicle.features.length ? (
                <section className="vehicle-features">
                  <h2>Features</h2>
                  <ul>{vehicle.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                </section>
              ) : null}
              <div className="vehicle-contact-panel">
                <p>Interested in this {vehicle.make}?</p>
                <a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a>
                <a className="button button-ghost" href={`mailto:smpaulino.business@gmail.com?subject=${encodeURIComponent(name)}`}>Email about this car</a>
              </div>
            </article>
          </div>
        </div>
      </main>
      <SiteFooter currentPage="inventory" />
    </>
  );
}
