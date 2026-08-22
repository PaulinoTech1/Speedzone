import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { TradeInForm } from "@/components/public/TradeInForm";

export const metadata: Metadata = {
  title: "Sell or Trade In Your Car",
  description:
    "Sell or trade in your car at SpeedZone Motorsports in Worcester, MA. Decode your VIN, tell us about your vehicle, and we'll follow up with next steps.",
  alternates: { canonical: "/sell-your-car" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/sell-your-car",
    title: "Sell or Trade In Your Car | SpeedZone Motorsports",
    description: "Sell or trade in your car at SpeedZone Motorsports in Worcester, MA.",
    images: [{ url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" }],
  },
  twitter: {
    card: "summary",
    title: "Sell or Trade In Your Car | SpeedZone Motorsports",
    description: "Sell or trade in your car at SpeedZone Motorsports in Worcester, MA.",
    images: ["/assets/speedzone-logo-v1.png"],
  },
};

export default function SellYourCarPage() {
  return (
    <>
      <SiteHeader currentPage="sell-your-car" />
      <main id="main" className="lead-page">
        <div className="shell">
          <section className="lead-hero">
            <p className="section-kicker">Turn your car into cash</p>
            <h1>
              Sell or <em>Trade In</em> Your Car
            </h1>
            <p className="lead-intro">
              Tell us about your vehicle and we&rsquo;ll follow up with an offer or next steps.
              Know your VIN? Decode it below to fill in the details automatically.
            </p>
          </section>

          <div className="lead-layout">
            <TradeInForm />

            <aside className="lead-info" aria-labelledby="trade-in-info-heading">
              <h2 id="trade-in-info-heading">What happens next</h2>
              <ul>
                <li>We&rsquo;ll review your vehicle details and reach out by phone or email.</li>
                <li>Bring your title and registration if you visit in person.</li>
                <li>Don&rsquo;t know your VIN? Fill in the year, make, and model instead.</li>
                <li>Trading in? We can apply the value toward another vehicle on the lot.</li>
              </ul>
              <div className="lead-contact">
                <p>Prefer to talk now?</p>
                <a className="button button-ghost" href="tel:+15088269405">
                  Call (508) 826-9405
                </a>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter currentPage="sell-your-car" />
    </>
  );
}
