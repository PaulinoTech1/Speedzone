import type { Metadata } from "next";

import { RecallCheck } from "@/components/public/RecallCheck";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";

export const metadata: Metadata = {
  title: "Free VIN Recall Check",
  description:
    "Check any used car for open safety recall campaigns by VIN, free. Powered by NHTSA data. From SpeedZone Motorsports in Worcester, MA.",
  alternates: { canonical: "/recall-check" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/recall-check",
    title: "Free VIN Recall Check | SpeedZone Motorsports",
    description: "Check any used car for safety recalls by VIN, free, using NHTSA data.",
    images: [{ url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" }],
  },
  twitter: {
    card: "summary",
    title: "Free VIN Recall Check | SpeedZone Motorsports",
    description: "Check any used car for safety recalls by VIN, free, using NHTSA data.",
    images: ["/assets/speedzone-logo-v1.png"],
  },
};

export default function RecallCheckPage() {
  return (
    <>
      <SiteHeader currentPage="recall-check" />
      <main id="main" className="lead-page">
        <div className="shell">
          <section className="lead-hero">
            <p className="section-kicker">Free tool · No signup</p>
            <h1>
              Check Any Car for <em>Safety Recalls</em>
            </h1>
            <p className="lead-intro">
              Enter a VIN to see the safety recall campaigns NHTSA has issued for that vehicle.
              Works for any car, not just ours &mdash; use it before you buy from anyone.
              Recall repairs are always free at a franchised dealer.
            </p>
          </section>

          <div className="lead-layout">
            <RecallCheck />

            <aside className="lead-info" aria-labelledby="recall-info-heading">
              <h2 id="recall-info-heading">Why this matters</h2>
              <ul>
                <li>Recall repairs are free, no matter how old the car or how many owners it has had.</li>
                <li>A recall is not the same as a defect in one specific car &mdash; it covers a whole model run.</li>
                <li>Many used cars have already had recall work completed.</li>
                <li>Ask any seller whether outstanding recall work has been done.</li>
              </ul>
              <div className="lead-contact">
                <p>Questions about a car on our lot?</p>
                <a className="button button-ghost" href="tel:+15088269405">
                  Call (508) 826-9405
                </a>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter currentPage="recall-check" />
    </>
  );
}
