import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";

export const metadata: Metadata = { title: "Current inventory", description: "Call us for current vehicle availability and pricing.", alternates: { canonical: "/inventory" } };

export default function Page() {
  return <>
    <SiteHeader currentPage="inventory" />
    <main id="main" className="inventory-page">
      <section className="inventory-hero"><div className="shell">
        <h1>Current inventory</h1>
        <p>Call us for current vehicle availability and pricing.</p>
        <a className="button button-primary" href="tel:+15088269405">Call (508) 826-9405</a>
      </div></section>
    </main>
    <SiteFooter currentPage="inventory" />
  </>;
}
