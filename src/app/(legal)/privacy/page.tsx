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
    <LegalPageShell title="Privacy" counterpart="terms" updated="September 14, 2026">
      <p>This website provides vehicle information and lets you request a test drive. It does not accept online vehicle purchases or provide customer accounts.</p>
      <h2>Test-drive requests and direct contact</h2>
      <p>The request form collects your name, email, phone number, vehicle of interest, preferred appointment date and time, and any notes you provide. We use these details to respond and arrange your visit. Please do not include payment details, identity documents, or sensitive financial information.</p>
      <p>Requests are encrypted by the application and stored in private Vercel Blob storage. Authorized staff access requests through a passkey-protected admin area. Email notifications sent through Resend contain a request reference; staff view contact details in the admin inbox. Information you send by phone or email is also processed by those services.</p>
      <h2>Technical information and admin sessions</h2>
      <p>Vercel processes requests to host and secure the website. Redis stores access-control and rate-limit data. The application uses keyed identifiers derived from IP and contact information for rate limiting and security monitoring. Raw IP addresses are not placed in application security events. Security events may include a non-reversible network fingerprint, an approximate country or region supplied by the hosting platform, and a general browser and operating-system family. Admin and Security Console sign-in use essential session cookies and passkeys. Configured logging providers may receive security events, but those events exclude customer form contents and authentication secrets.</p>
      <h2>Website problem reports</h2>
      <p>If you report a problem, we collect the text you submit and an optional reply address. Reports are encrypted, accessible through the independently authenticated Security Console, and expire from application storage after 30 days. Rate limiting uses a keyed identifier derived from the client IP; raw IPs are not stored by this reporting feature. Diagnostic records contain operation codes, timestamps and random references rather than form contents, and expire after 7 days. Hosting providers may retain separate operational records.</p>
      <h2>Retention and privacy requests</h2>
      <p>Customer requests are retained for staff follow-up; the application does not currently delete them automatically. Contact us below to ask about access, correction, or deletion of information you submitted. Hosting, email, and security providers may retain separate operational records.</p>

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
