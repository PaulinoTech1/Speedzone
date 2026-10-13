import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { publicPhotos, serializeJsonLd, vehicleStructuredData } from "@/lib/vehicle-structured-data";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";
import { VehiclePhotoCarousel } from "@/components/public/VehiclePhotoCarousel";
import { detailLabels, readInventory, vehicleDetailKeys, vehicleIdPattern, vehiclePath, type Vehicle } from "@/lib/inventory";

type Props = { params: Promise<{ id: string }> };

async function findVehicle(id: string): Promise<Vehicle | null> {
  if (!vehicleIdPattern.test(id)) return null;
  return (await readInventory()).find(vehicle => vehicle.id === id) ?? null;
}

const titleOf = (vehicle: Vehicle) => [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  let vehicle: Vehicle | null = null;
  try { vehicle = await findVehicle(id); } catch { /* fall through to a generic title */ }
  if (!vehicle) return { title: "Vehicle not found", robots: { index: false } };
  const title = titleOf(vehicle);
  const sold = vehicle.status === "sold";
  const photos = publicPhotos(vehicle);
  return {
    title,
    description: `${title} with ${vehicle.mileage.toLocaleString("en-US")} miles at SpeedZone Motorsports.`,
    alternates: { canonical: vehiclePath(vehicle) },
    // Sold listings keep their stable URL (catalog feeds may still reference it) but leave the index.
    robots: vehicle.status === "sold" ? { index: false } : undefined,
    openGraph: {
      type: "website",
      url: vehiclePath(vehicle),
      title,
      description: `${sold ? "Sold · " : `$${vehicle.price.toLocaleString("en-US")} · `}${vehicle.mileage.toLocaleString("en-US")} miles${vehicle.bodyStyle ? ` · ${vehicle.bodyStyle}` : ""}`,
      ...(photos.length ? { images: photos.slice(0, 4).map(url => ({ url, alt: title })) } : {}),
    },
    twitter: photos.length ? { card: "summary_large_image", title, images: [photos[0]!] } : { card: "summary", title },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  let vehicle: Vehicle | null;
  try {
    vehicle = await findVehicle(id);
  } catch {
    return <><SiteHeader currentPage="inventory" /><main id="main"><section className="inventory-list"><div className="shell"><div className="inventory-unavailable" role="status"><h1>Inventory is temporarily unavailable.</h1><p>Please call us for current vehicle availability and pricing.</p><a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a></div></div></section></main><SiteFooter currentPage="inventory" /></>;
  }
  if (!vehicle) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const title = titleOf(vehicle);
  const sold = vehicle.status === "sold";
  const specs: Array<[string, string]> = [
    ["Mileage", `${vehicle.mileage.toLocaleString("en-US")} miles`],
    ["Condition", vehicle.condition],
    ...(vehicle.vin ? [["VIN", vehicle.vin] as [string, string]] : []),
    ...vehicleDetailKeys.filter(key => vehicle[key]).map(key => [detailLabels[key], String(vehicle[key])] as [string, string]),
  ];
  return <><script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(vehicleStructuredData(vehicle)) }} /><SiteHeader currentPage="inventory" /><main id="main">
    <section className="inventory-list vehicle-detail"><div className="shell">
      <p><Link href="/inventory">← Back to inventory</Link></p>
      <article className="vehicle-card" data-testid="vehicle-detail">
        {vehicle.photos.length > 0 ? <VehiclePhotoCarousel images={vehicle.photos} alt={title} /> : <div className="vehicle-image-placeholder">SpeedZone Motorsports</div>}
        <div className="vehicle-card-body">
          <span className="vehicle-status">{sold ? "sold" : vehicle.status}</span>
          <h1>{title}</h1>
          {sold ? <p role="status">This vehicle has been sold. <Link href="/inventory">See current inventory</Link>.</p> : <p className="vehicle-price">${vehicle.price.toLocaleString("en-US")}</p>}
          <dl className="vehicle-specs">{specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {vehicle.description ? <p className="vehicle-description">{vehicle.description}</p> : null}
          {sold ? null : <div className="admin-listing-actions"><a className="button button-primary" href="/test-drive">Schedule a test drive</a><a className="button button-secondary" href="tel:+15088269405">Call (508) 826-9405</a></div>}
        </div>
      </article>
    </div></section>
  </main><SiteFooter currentPage="inventory" /></>;
}
