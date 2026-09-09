import type { Metadata } from "next";
import { headers } from "next/headers";

import { CostCalculator } from "@/components/public/CostCalculator";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";

export const metadata: Metadata = {
  title: "Used Car Taxes & Fees in Massachusetts",
  description:
    "What a used car really costs in Massachusetts: 6.25% sales tax, $75 title, $60 registration, and $35 inspection. Estimate your total up front with our calculator.",
  alternates: { canonical: "/buying-costs" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/buying-costs",
    title: "Used Car Taxes & Fees in Massachusetts | SpeedZone Motorsports",
    description:
      "Sales tax, title, registration, and inspection costs on a used car in Massachusetts, explained plainly.",
    images: [{ url: "/assets/speedzone-logo-v1.png", width: 192, height: 192, alt: "SpeedZone Motorsports" }],
  },
  twitter: {
    card: "summary",
    title: "Used Car Taxes & Fees in Massachusetts | SpeedZone Motorsports",
    description:
      "Sales tax, title, registration, and inspection costs on a used car in Massachusetts.",
    images: ["/assets/speedzone-logo-v1.png"],
  },
};

const faqItems = [
  {
    question: "How much is sales tax on a used car in Massachusetts?",
    answer:
      "Massachusetts charges 6.25% sales tax on a vehicle purchase. On a $3,500 car that is about $219.",
  },
  {
    question: "What does it cost to title and register a car in Massachusetts?",
    answer:
      "The RMV charges $75 for a title certificate and $60 for a standard two-year passenger registration.",
  },
  {
    question: "Do I need a state inspection in Massachusetts?",
    answer:
      "Yes. Every registered vehicle needs an annual safety and emissions inspection, which costs $35 at a licensed inspection station. You have seven days from registration to get it done.",
  },
  {
    question: "What is motor vehicle excise tax?",
    answer:
      "Excise tax is billed separately every year by your city or town, based on the vehicle's value and age. It is not paid at the time of purchase, so it is not part of your up-front cost.",
  },
];

export default async function BuyingCostsPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <SiteHeader currentPage="buying-costs" />
      <main id="main" className="lead-page">
        <div className="shell">
          <section className="lead-hero">
            <p className="section-kicker">No surprises</p>
            <h1>
              What a Used Car <em>Really Costs</em>
            </h1>
            <p className="lead-intro">
              The sticker price is not the whole story in Massachusetts. Here is exactly what gets
              added on top, so you can budget before you shop instead of finding out at the counter.
            </p>
          </section>

          <div className="lead-layout">
            <div>
              <CostCalculator />

              <section className="cost-detail" aria-labelledby="cost-detail-heading">
                <h2 id="cost-detail-heading">Where each cost comes from</h2>

                <h3>Sales tax &mdash; 6.25%</h3>
                <p>
                  Massachusetts charges 6.25% sales tax on a vehicle purchase, collected when you
                  register. On a $3,500 car that is about $219; on an $8,000 car it is $500.
                </p>

                <h3>Title &mdash; $75</h3>
                <p>
                  The RMV charges $75 to issue or transfer the title certificate that proves you own
                  the vehicle.
                </p>

                <h3>Registration &mdash; $60</h3>
                <p>
                  A standard passenger registration is $60 and covers two years. If you already have
                  plates you may be able to transfer them instead.
                </p>

                <h3>State inspection &mdash; $35</h3>
                <p>
                  Every registered vehicle in Massachusetts needs an annual safety and emissions
                  inspection, done at a licensed inspection station rather than the RMV. You have
                  seven days after registering to get it done.
                </p>

                <h3>Documentation fee &mdash; $300</h3>
                <p>
                  SpeedZone charges a $300 documentation fee for preparing and processing the vehicle
                  purchase paperwork. This dealer fee is included in the calculator above.
                </p>

                <h3>Excise tax &mdash; billed later</h3>
                <p>
                  Your city or town bills motor vehicle excise tax once a year, based on the
                  vehicle&rsquo;s value and age. Because it does not come due at purchase, we leave
                  it out of the up-front estimate above &mdash; but budget for it.
                </p>

                <h3>Insurance &mdash; before you drive</h3>
                <p>
                  Massachusetts requires active insurance before a vehicle can be registered. Costs
                  vary widely by driver, so get a quote on the specific vehicle before you commit.
                </p>
              </section>

              <section className="cost-detail" aria-labelledby="cost-faq-heading">
                <h2 id="cost-faq-heading">Common questions</h2>
                <div className="tips-grid">
                  {faqItems.map((item, index) => (
                    <details className="tip" name="cost-faq" key={item.question}>
                      <summary>
                        <span>{String(index + 1).padStart(2, "0")}</span> {item.question}
                      </summary>
                      <div className="tip-body">
                        <p>{item.answer}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>

              <p className="cost-sources">
                Figures reflect published Massachusetts RMV and Department of Revenue rates and are
                provided for planning only. Confirm current amounts at{" "}
                <a href="https://www.mass.gov/rmv" target="_blank" rel="noopener noreferrer">
                  mass.gov/rmv
                </a>
                .
              </p>
            </div>

            <aside className="lead-info" aria-labelledby="cost-info-heading">
              <h2 id="cost-info-heading">Budgeting tips</h2>
              <ul>
                <li>Set aside roughly 11&ndash;12% over the sticker price for tax and fees.</li>
                <li>Ask what is already included before you agree to a price.</li>
                <li>Keep a cushion for tires, brakes, or an oil change after purchase.</li>
                <li>Get an insurance quote on the exact vehicle before committing.</li>
              </ul>
              <div className="lead-contact">
                <p>Want a straight answer on a specific car?</p>
                <a className="button button-ghost" href="tel:+15088269405">
                  Call (508) 826-9405
                </a>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter currentPage="buying-costs" />
    </>
  );
}
