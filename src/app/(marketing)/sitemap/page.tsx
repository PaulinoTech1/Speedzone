import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";
import { readInventory, vehiclePath, type Vehicle } from "@/lib/inventory";

// Rendered per request so new listings appear without a redeploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sitemap",
  description: "Every page on the SpeedZone Motorsports website, including current vehicle listings.",
  alternates: { canonical: "/sitemap" },
  robots: { index: true, follow: true },
};

const staticPages = [
  { href: "/", label: "Home" },
  { href: "/inventory", label: "Current inventory" },
  { href: "/test-drive", label: "Schedule a test drive" },
  { href: "/sell-your-car", label: "Sell your car" },
  { href: "/buying-costs", label: "Buying costs" },
  { href: "/recall-check", label: "Free recall check" },
  { href: "/road-trip", label: "Road trip" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of use" },
];

function vehicleLabel(vehicle: Vehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
}

export default async function SitemapPage() {
  let vehicles: Vehicle[] = [];
  // Inventory storage problems must not take the sitemap page down.
  try {
    vehicles = (await readInventory()).filter(vehicle => vehicle.status !== "sold");
  } catch {
    // Static pages only.
  }

  return (
    <>
      <SiteHeader currentPage="sitemap" />
      <main className="shell legal-main" id="main">
        <h1>Sitemap</h1>
        <p>
          Every page on this site, in one place. Search engines can use the{" "}
          <a href="/sitemap.xml">XML sitemap</a>.
        </p>
        <h2>Pages</h2>
        <ul>
          {staticPages.map(page => (
            <li key={page.href}>
              <Link href={page.href}>{page.label}</Link>
            </li>
          ))}
        </ul>
        <h2>Current inventory</h2>
        {vehicles.length === 0 ? (
          <p>No vehicles are listed right now. Call us for current availability and pricing.</p>
        ) : (
          <ul>
            {vehicles.map(vehicle => (
              <li key={vehicle.id}>
                <Link href={vehiclePath(vehicle)}>{vehicleLabel(vehicle)}</Link>
                {" — $"}
                {vehicle.price.toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter currentPage="sitemap" />
    </>
  );
}
