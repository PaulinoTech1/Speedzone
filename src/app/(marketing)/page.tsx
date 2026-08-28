import type { Metadata } from "next";
import { headers } from "next/headers";

import { HomePageContent, homeFaqItems } from "@/components/public/HomePageContent";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";

export const metadata: Metadata = {
  title: {
    absolute: "SpeedZone Motorsports | Affordable Used Cars in Worcester, MA",
  },
  description:
    "Find quality, affordable used cars at SpeedZone Motorsports in Worcester, Massachusetts. Honest service, inspected vehicles, and straightforward pricing.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title:
      "SpeedZone Motorsports | Affordable Used Cars in Worcester, MA",
    description:
      "Quality used cars, honest service, and straightforward pricing in Worcester, Massachusetts.",
    images: [{ url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" }],
  },
  twitter: {
    card: "summary",
    title: "SpeedZone Motorsports | Worcester, MA",
    description:
      "Affordable used cars and honest service in Worcester, Massachusetts.",
    images: ["/assets/speedzone-logo-v1.png"],
  },
};

const dealerStructuredData = {
  "@context": "https://schema.org",
  "@type": "AutoDealer",
  "@id": "https://www.speedzonems.com/#dealership",
  name: "SpeedZone Motorsports",
  description:
    "Affordable used cars and straightforward service in Worcester, Massachusetts.",
  url: "https://www.speedzonems.com/",
  logo: "https://www.speedzonems.com/assets/speedzone-logo-v1.png",
  telephone: "+1-508-826-9405",
  email: "smpaulino.business@gmail.com",
  foundingDate: "2010",
  priceRange: "$",
  address: {
    "@type": "PostalAddress",
    streetAddress: "1094 Main St",
    addressLocality: "Worcester",
    addressRegion: "MA",
    postalCode: "01603",
    addressCountry: "US",
  },
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "10:00",
    closes: "16:00",
  },
  sameAs: [
    "https://www.instagram.com/speedzone_motorsports/",
    "https://share.google/IObSwqXQNUBsJWF4J",
  ],
};

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: homeFaqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default async function HomePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(dealerStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqStructuredData),
        }}
      />
      <SiteHeader />
      <HomePageContent />
      <SiteFooter />
    </>
  );
}
