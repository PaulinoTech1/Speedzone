import type { Metadata } from "next";

import { LegalPageShell } from "@/components/public/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy information for the SpeedZone Motorsports website.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy" counterpart="terms">
      <p>
        This website is designed to help you learn about SpeedZone Motorsports
        and contact us directly. This version of the site does not include an
        account system, online purchase flow, advertising tracker, or analytics
        script.
      </p>

      <h2>Information you choose to share</h2>
      <p>
        If you call or email us, we receive the information you choose to
        provide through your phone or email service. Please do not send
        sensitive financial information by ordinary email.
      </p>

      <h2>Hosting and basic technical data</h2>
      <p>
        Our hosting provider may process basic request information—such as an IP
        address, browser type, requested page, and timestamp—to deliver and
        secure the website. That processing is controlled by the provider’s own
        terms and privacy practices.
      </p>

      <h2>Links to other services</h2>
      <p>
        The site links to services such as Google Maps, Google Reviews,
        Instagram, your phone app, and your email app. Those services handle
        information under their own privacy policies once you follow a link.
      </p>

      <h2>Questions</h2>
      <p>
        For privacy questions about this website, email{" "}
        <a href="mailto:smpaulino.business@gmail.com">
          smpaulino.business@gmail.com
        </a>{" "}
        or call <a href="tel:+15088269405">(508) 826-9405</a>.
      </p>
    </LegalPageShell>
  );
}
