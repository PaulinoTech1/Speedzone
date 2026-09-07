import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/public/SiteChrome";

export const metadata: Metadata = { title: "Check for safety recalls", description: "Use the official NHTSA lookup to check your vehicle for open safety recalls.", alternates: { canonical: "/recall-check" } };

export default function Page() {
  return <>
    <SiteHeader currentPage="recall-check" />
    <main id="main" className="inventory-page">
      <section className="inventory-hero"><div className="shell">
        <h1>Check for safety recalls</h1>
        <p>Use the official NHTSA lookup to check your vehicle for open safety recalls.</p>
        <a className="button button-primary" href="https://www.nhtsa.gov/recalls">Open NHTSA recall lookup</a>
      </div></section>
    </main>
    <SiteFooter currentPage="recall-check" />
  </>;
}
