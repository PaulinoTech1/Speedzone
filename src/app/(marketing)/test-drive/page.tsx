import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { TestDriveForm } from "@/components/public/TestDriveForm";

export const metadata: Metadata = {
  title: "Request a Test Drive",
  description:
    "Schedule a test drive at SpeedZone Motorsports in Worcester, MA. Tell us which vehicle you'd like to drive and when works best.",
  alternates: { canonical: "/test-drive" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/test-drive",
    title: "Request a Test Drive | SpeedZone Motorsports",
    description:
      "Schedule a test drive at SpeedZone Motorsports in Worcester, MA.",
  },
  twitter: {
    card: "summary",
    title: "Request a Test Drive | SpeedZone Motorsports",
    description: "Schedule a test drive at SpeedZone Motorsports in Worcester, MA.",
  },
};

export default function TestDrivePage() {
  return (
    <>
      <SiteHeader currentPage="test-drive" />
      <main id="main" className="test-drive-page">
        <div className="shell">
          <section className="test-drive-hero">
            <p className="section-kicker">Schedule a visit</p>
            <h1>
              Request a <em>Test Drive</em>
            </h1>
            <p className="test-drive-lead">
              Tell us which car you&rsquo;d like to drive and when works best. Our team confirms
              every request by phone or email, usually within one business day.
            </p>
          </section>

          <div className="test-drive-layout">
            <TestDriveForm />

            <aside className="test-drive-info" aria-labelledby="test-drive-info-heading">
              <h2 id="test-drive-info-heading">What to expect</h2>
              <ul>
                <li>Bring a valid driver&rsquo;s license for the test drive.</li>
                <li>Test drives typically run 15&ndash;20 minutes.</li>
                <li>We&rsquo;ll confirm your appointment before you arrive.</li>
                <li>Not sure which car yet? Tell us what you&rsquo;re looking for.</li>
              </ul>
              <div className="test-drive-contact">
                <p>Prefer to talk now?</p>
                <a className="button button-ghost" href="tel:+15088269405">
                  Call (508) 826-9405
                </a>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter currentPage="test-drive" />
    </>
  );
}
