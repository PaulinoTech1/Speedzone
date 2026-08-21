import type { Metadata } from "next";

import { LegalPageShell } from "@/components/public/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Website terms for SpeedZone Motorsports in Worcester, Massachusetts.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms" counterpart="privacy">
      <p>
        By using this website, you agree to use it for lawful, personal
        purposes. The site provides general dealership and contact information;
        it is not an online sales contract.
      </p>

      <h2>Inventory and pricing</h2>
      <p>
        Vehicles, prices, mileage, features, and availability can change
        without notice. Photos and descriptions, when provided, are for general
        reference. Please call SpeedZone Motorsports to confirm current details
        before making a trip or purchase decision.
      </p>

      <h2>Vehicle transactions</h2>
      <p>
        A vehicle sale is governed by the documents signed for that transaction,
        not by this website. Nothing on this site is a promise of financing,
        approval, warranty coverage, or a specific vehicle’s availability.
      </p>

      <h2>Maintenance information</h2>
      <p>
        Car-care tips on the site are general information. Your owner’s manual
        and a qualified technician should guide maintenance and repair decisions
        for your specific vehicle.
      </p>

      <h2>External links</h2>
      <p>
        Links to third-party websites are provided for convenience. SpeedZone
        Motorsports does not control those websites or their content.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this site can be sent to{" "}
        <a href="mailto:smpaulino.business@gmail.com">
          smpaulino.business@gmail.com
        </a>{" "}
        or discussed by calling{" "}
        <a href="tel:+15088269405">(508) 826-9405</a>.
      </p>
    </LegalPageShell>
  );
}
