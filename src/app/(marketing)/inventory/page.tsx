import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";
import { VehiclePhotoCarousel } from "@/components/public/VehiclePhotoCarousel";
import { readInventory } from "@/lib/inventory";

export const metadata: Metadata = { title: "Current inventory", description: "Browse quality used vehicles available at SpeedZone Motorsports.", alternates: { canonical: "/inventory" } };

export default async function Page() {
  let vehicles;
  try {
    vehicles = (await readInventory()).filter(vehicle => vehicle.status !== "sold");
  } catch {
    return <><SiteHeader currentPage="inventory" /><main id="main"><section className="inventory-hero"><div className="shell"><p className="eyebrow">SpeedZone Motorsports</p><h1>Current inventory</h1><p>Find your next ride from our current selection of quality, affordable used vehicles.</p></div></section><section className="inventory-list"><div className="shell"><div className="inventory-unavailable" role="status"><h2>Inventory is temporarily unavailable.</h2><p>Please call us for current vehicle availability and pricing.</p><a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a></div></div></section></main><SiteFooter currentPage="inventory" /></>;
  }

  return <><SiteHeader currentPage="inventory" /><main id="main"><section className="inventory-hero"><div className="shell"><p className="eyebrow">SpeedZone Motorsports</p><h1>Current inventory</h1><p>Find your next ride from our current selection of quality, affordable used vehicles.</p></div></section><section className="inventory-list"><div className="shell"><div className="inventory-heading"><h2>Available vehicles</h2><a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a></div>{vehicles.length === 0 ? <div className="inventory-empty"><h2>New arrivals are on the way.</h2><p>Call us for current availability and pricing.</p></div> : <div className="vehicle-grid">{vehicles.map((vehicle) => <article className="vehicle-card" key={vehicle.id}>{vehicle.photos.length > 0 ? <VehiclePhotoCarousel images={vehicle.photos} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} /> : <div className="vehicle-image-placeholder">SpeedZone Motorsports</div>}<div className="vehicle-card-body"><span className="vehicle-status">{vehicle.status}</span><h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3><p className="vehicle-price">${vehicle.price.toLocaleString()}</p><p>{vehicle.mileage.toLocaleString()} miles · {vehicle.condition}</p><p className="vehicle-description">{vehicle.description}</p><a className="button button-secondary" href="tel:+15088269405">Ask about this vehicle</a></div></article>)}</div>}</div></section></main><SiteFooter currentPage="inventory" /></>;
}
