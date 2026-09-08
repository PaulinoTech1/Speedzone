import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { TestDriveForm } from "@/components/public/TestDriveForm";

const dealershipHours = [
  ["Monday–Friday", "10:00 AM–4:00 PM"],
  ["Saturday", "By appointment"],
  ["Sunday", "Closed"],
] as const;

export const metadata: Metadata = {
  title: "Schedule a Test Drive | SpeedZone Motorsports",
  description: "Request a test drive at SpeedZone Motorsports in Worcester, Massachusetts.",
};

export default function TestDrivePage() {
  return (
    <>
      <SiteHeader currentPage="test-drive" />
      <main id="main" className="test-drive-page">
        <section className="test-drive-hero shell">
          <div className="test-drive-intro">
            <p className="eyebrow">Take it for a spin</p>
            <h1>Find out how it feels behind the wheel.</h1>
            <p className="lede">
              Tell us what you&apos;re interested in and when you&apos;d like to
              visit. We&apos;ll make sure the vehicle is ready when you arrive.
            </p>
            <div className="hours-card">
              <div>
                <p className="eyebrow">Visit hours</p>
                <h2>Plan your visit</h2>
              </div>
              <dl>
                {dealershipHours.map(([day, time]) => (
                  <div key={day}>
                    <dt>{day}</dt>
                    <dd>{time}</dd>
                  </div>
                ))}
              </dl>
              <p className="hours-note">Sunday appointments are not available.</p>
            </div>
          </div>
          <TestDriveForm />
        </section>
      </main>
      <SiteFooter currentPage="test-drive" />
    </>
  );
}
