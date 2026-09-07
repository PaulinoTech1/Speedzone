import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";

export const metadata: Metadata = { title: "Sell or trade in your car", description: "Contact SpeedZone to discuss your vehicle and arrange a visit.", alternates: { canonical: "/sell-your-car" } };

export default function Page() {
  return <>
    <SiteHeader currentPage="sell-your-car" />
    <main id="main" className="inventory-page">
      <section className="inventory-hero"><div className="shell">
        <h1>Sell or trade in your car</h1>
        <p>Contact SpeedZone to discuss your vehicle and arrange a visit.</p>
        <a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a>
      </div></section>
    </main>
    <SiteFooter currentPage="sell-your-car" />
  </>;
}
