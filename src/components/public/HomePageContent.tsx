import { CarCareTips } from "./CarCareTips";
import Link from "next/link";

const directionsUrl =
  "https://maps.google.com/?q=1094+Main+St+Worcester+MA+01603";

const careTips = [
  {
    groups: "service",
    title: "Regular oil changes",
    guidance:
      "Use the oil type and interval listed for your vehicle. Many cars need service somewhere between 3,000 and 7,500 miles, but the owner’s manual is the source of truth.",
    payoff:
      "Fresh oil protects moving engine parts and helps limit avoidable wear.",
  },
  {
    groups: "monthly",
    title: "Check tire pressure",
    guidance:
      "Check tires when they are cold, about once a month and before long trips. Use the pressure on the driver-door label, not the number molded into the tire.",
    payoff:
      "Correct pressure supports safer handling and helps your tread wear more evenly.",
  },
  {
    groups: "seasonal warning",
    title: "Battery care",
    guidance:
      "Keep terminals clean and connections secure. Have the battery tested before temperature extremes or when starts become slow.",
    payoff:
      "A quick check can reduce the chance of an inconvenient no-start.",
  },
  {
    groups: "monthly service",
    title: "Coolant & fluids",
    guidance:
      "Check coolant, brake, transmission, power-steering, and washer fluids as applicable. Investigate unexpected drops instead of repeatedly topping them off, and never open a hot cooling system.",
    payoff: "Proper fluids help cool, lubricate, and protect expensive systems.",
  },
  {
    groups: "service warning",
    title: "Brake inspections",
    guidance:
      "Do not ignore grinding, vibration, pulling, a soft pedal, or a change in stopping distance. Have concerns inspected promptly; if braking feels unsafe, stop driving and arrange service.",
    payoff:
      "Early attention can protect more of the braking system—and your safety.",
  },
  {
    groups: "service",
    title: "Follow the schedule",
    guidance:
      "Use the normal or severe-duty schedule in your owner’s manual based on how and where you drive.",
    payoff:
      "Timely service helps you plan upkeep before wear turns into downtime.",
  },
  {
    groups: "service",
    title: "Rotate and align tires",
    guidance:
      "Rotate tires at the interval recommended for your vehicle. If it pulls, the steering wheel sits off-center, or wear is uneven, have the alignment checked.",
    payoff: "Even wear can help you get more useful life from a full set of tires.",
  },
  {
    groups: "service seasonal",
    title: "Replace filters",
    guidance:
      "Inspect the engine air filter and cabin filter on schedule, especially after dusty driving or heavy pollen seasons.",
    payoff:
      "Clean filters support engine airflow and a more effective heating and cooling system.",
  },
  {
    groups: "service warning",
    title: "Inspect belts and hoses",
    guidance:
      "Look for cracks, glazing, bulges, leaks, or frayed edges. Chirping sounds, coolant smells, or visible damage deserve attention.",
    payoff:
      "Replacing a worn part on your schedule is better than waiting for it to fail on the road.",
  },
  {
    groups: "monthly seasonal",
    title: "Test lights and wipers",
    guidance:
      "Walk around the car to test exterior lights. Replace wipers that streak, chatter, or leave gaps before bad weather arrives.",
    payoff:
      "Clear visibility helps protect you, your car, and everyone sharing the road.",
  },
  {
    groups: "seasonal",
    title: "Wash away road salt",
    guidance:
      "During and after winter, rinse road salt from the body, wheel wells, and undercarriage when temperatures allow.",
    payoff:
      "Removing corrosive residue helps protect metal, fasteners, and brake components.",
  },
  {
    groups: "service",
    title: "Keep service records",
    guidance:
      "Save receipts and record dates, mileage, parts, and upcoming work in a notebook or phone note.",
    payoff:
      "A clear history prevents duplicate work, supports diagnosis, and documents consistent care.",
  },
  {
    groups: "warning",
    title: "Act on warning lights",
    guidance:
      "Read the owner’s manual when a warning appears. A flashing check-engine light or red oil-pressure or temperature warning can require stopping safely and shutting the engine off.",
    payoff:
      "A quick response can keep a developing problem from causing more damage.",
  },
] as const;

// Shared with the FAQPage structured data in app/(marketing)/page.tsx so the
// visible copy and the JSON-LD sent to search/AI crawlers can't drift apart.
export const homeFaqItems = [
  {
    question: "What are SpeedZone Motorsports' hours?",
    answer:
      "We're open Monday through Friday, 10am to 4pm, and Saturday by appointment.",
  },
  {
    question: "Where is SpeedZone Motorsports located?",
    answer: "1094 Main St, Worcester, MA 01603.",
  },
  {
    question: "How do I schedule a test drive?",
    answer:
      "Request one online, or call (508) 826-9405. Tell us which vehicle you'd like to drive and your preferred date and time, and we'll confirm before you arrive.",
  },
  {
    question: "Are SpeedZone's vehicles inspected before sale?",
    answer: "Yes. Every vehicle is reviewed before it reaches the lot.",
  },
  {
    question: "Does SpeedZone use high-pressure sales tactics?",
    answer:
      "No. Take your time, ask questions, and find the fit that works for you.",
  },
  {
    question: "How long has SpeedZone Motorsports been in business?",
    answer:
      "Since 2010. For more than 15 years, Worcester families have turned to SpeedZone for affordable vehicles and straightforward help.",
  },
] as const;

export function HomePageContent() {
  return (
    <main id="main">
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-grid" aria-hidden="true" />
        <div className="shell hero-content">
          <p className="eyebrow">
            <span className="flag" aria-hidden="true" /> Worcester,
            Massachusetts
          </p>
          <h1 id="hero-title">
            Find your perfect ride at <em>unbeatable prices.</em>
          </h1>
          <p className="hero-copy">
            Affordable, quality used cars with straightforward service from a
            local team that puts Worcester drivers first.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="tel:+15088269405">
              Call about a car
            </a>
            <a
              className="button button-ghost"
              href={directionsUrl}
              target="_blank"
              rel="noopener"
            >
              Get directions
            </a>
          </div>
          <dl className="proof-strip" aria-label="SpeedZone highlights">
            <div>
              <dt>Starting at</dt>
              <dd>$2,500</dd>
            </div>
            <div>
              <dt>Google rating</dt>
              <dd>
                5<span aria-hidden="true">★</span>
              </dd>
            </div>
            <div>
              <dt>Local since</dt>
              <dd>2010</dd>
            </div>
          </dl>
        </div>
        <div className="finish-line" aria-hidden="true" />
      </section>

      <section
        className="section arrivals"
        id="inventory"
        aria-labelledby="arrivals-title"
      >
        <div className="shell">
          <div className="arrivals-panel">
            <div className="arrivals-copy">
              <p className="section-kicker">Latest arrivals</p>
              <h2 id="arrivals-title">
                A fresh lot.
                <br />
                <span>Every month.</span>
              </h2>
              <p>
                Our inventory changes fast. Every car is carefully chosen and
                inspected before it reaches the lot. Call or follow us for the
                newest arrivals.
              </p>
              <div className="action-row">
                <Link
                  className="button button-primary"
                  href="/inventory"
                >
                  Browse current inventory
                </Link>
                <a className="text-link" href="tel:+15088269405">
                  Ask what’s available <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
            <aside className="lot-card" aria-labelledby="lot-card-title">
              <span className="lot-card-label">On the lot</span>
              <h3 id="lot-card-title">Affordable sedans, SUVs &amp; trucks</h3>
              <p>
                Looking for something specific or shopping under $10,000? Tell
                us what you need.
              </p>
              <a href="mailto:smpaulino.business@gmail.com?subject=Vehicle%20inquiry">
                Email your wish list
              </a>
            </aside>
          </div>
        </div>
      </section>

      <section
        className="section story"
        id="about"
        aria-labelledby="story-title"
      >
        <div className="shell narrow-shell">
          <p className="section-kicker centered">New management</p>
          <h2 id="story-title" className="centered">
            A new chapter for <span>SpeedZone.</span>
          </h2>
          <p className="story-lead">
            A new generation has taken the wheel, bringing fresh energy and
            passion to a trusted family business.
          </p>
          <p>
            What started as a legacy has been given new life and drive—fueled
            by family, determination, and a renewed commitment to Worcester.
            We’re not just selling cars. We’re continuing a tradition of honest
            service, quality vehicles, and putting our community first.
          </p>
          <div className="diamond-rule" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>

      <section
        className="section why"
        id="why-us"
        aria-labelledby="why-title"
      >
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Why SpeedZone</p>
              <h2 id="why-title">
                Built on trust.
                <br />
                <span>Driven by value.</span>
              </h2>
            </div>
            <p>
              For more than 15 years, Worcester families have turned to
              SpeedZone for affordable vehicles and straightforward help.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>Competitive prices</h3>
              <p>
                We work hard to keep quality vehicles within reach and help you
                understand the value before you buy.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>Quality inspected</h3>
              <p>
                Every vehicle is reviewed before it reaches the lot, so you can
                shop with more confidence.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>No-pressure sales</h3>
              <p>
                Take your time, ask questions, and find the fit that works for
                you. Our team is here to help.
              </p>
            </article>
          </div>

          <aside className="review-panel" aria-label="Google reviews">
            <div>
              <div className="stars">
                <span role="img" aria-label="Five out of five stars">
                  ★★★★★
                </span>
              </div>
              <p>
                <strong>See what Worcester drivers are saying.</strong>
                <br />
                Read feedback from people who have visited SpeedZone.
              </p>
            </div>
            <a
              className="button button-ghost"
              href="https://share.google/NaPjBJWLlkGfHci1J"
              target="_blank"
              rel="noopener"
            >
              Read Google reviews
            </a>
          </aside>
        </div>
      </section>

      <section
        className="section maintenance"
        id="maintenance"
        aria-labelledby="maintenance-title"
      >
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Protect your investment</p>
              <h2 id="maintenance-title">
                Put care in.
                <br />
                <span>Get more miles out.</span>
              </h2>
            </div>
            <p>
              Maintenance is an investment in the car you already own. Planned
              care helps protect its reliability, catches wear earlier, and
              gives it a better chance to stay on the road longer.
            </p>
          </div>

          <div className="investment-panel">
            <div className="investment-copy">
              <p className="investment-label">The maintenance mindset</p>
              <h3>Protect the miles you have already paid for.</h3>
              <p>
                Small, consistent upkeep can be easier to plan for than a
                preventable breakdown. Think of every inspection, fluid check,
                and service record as protection for your car’s next mile.
              </p>
            </div>
            <ul className="investment-benefits">
              <li>
                <strong>Preserve reliability</strong>
                <span>Help key systems keep doing their job.</span>
              </li>
              <li>
                <strong>Catch wear sooner</strong>
                <span>Address warning signs before they grow.</span>
              </li>
              <li>
                <strong>Support long-term value</strong>
                <span>Keep a clear record of consistent care.</span>
              </li>
            </ul>
          </div>

          <CarCareTips />

          <div className="tips-grid">
            {careTips.map((tip, index) => (
              <details
                className="tip"
                data-tip-groups={tip.groups}
                name="car-care-tip"
                open={index === 0}
                key={tip.title}
              >
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span> {tip.title}
                </summary>
                <div className="tip-body">
                  <p>{tip.guidance}</p>
                  <p className="tip-payoff">
                    <strong>Why it pays:</strong> {tip.payoff}
                  </p>
                </div>
              </details>
            ))}
          </div>

          <p className="maintenance-note">
            Intervals vary by vehicle and driving conditions. Follow your
            owner’s manual and ask a qualified technician when you are unsure.
            Have a general question? <a href="tel:+15088269405">Call us</a> or
            stop by the lot.
          </p>
        </div>
      </section>

      <section className="section faq" id="faq" aria-labelledby="faq-title">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Common questions</p>
              <h2 id="faq-title">
                Questions?
                <br />
                <span>We&rsquo;ve got answers.</span>
              </h2>
            </div>
            <p>
              Quick answers about hours, test drives, and how we do business.
              Still not covered? <a href="tel:+15088269405">Call us</a>.
            </p>
          </div>

          <div className="tips-grid">
            {homeFaqItems.map((item, index) => (
              <details className="tip" name="home-faq" key={item.question}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span> {item.question}
                </summary>
                <div className="tip-body">
                  <p>{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section
        className="section contact"
        id="contact"
        aria-labelledby="contact-title"
      >
        <div className="shell contact-layout">
          <div className="contact-intro">
            <p className="section-kicker">Visit SpeedZone</p>
            <h2 id="contact-title">
              Your next ride
              <br />
              <span>might be here.</span>
            </h2>
            <p>
              Stop by our Worcester lot or get in touch before you visit. We’ll
              help you find out what’s available.
            </p>
            <div className="contact-actions">
              <a className="button button-primary" href="tel:+15088269405">
                Call (508) 826-9405
              </a>
              <a
                className="button button-ghost"
                href={directionsUrl}
                target="_blank"
                rel="noopener"
              >
                Open directions
              </a>
            </div>
          </div>

          <div className="contact-cards">
            <article>
              <span>Location</span>
              <h3>1094 Main St</h3>
              <p>Worcester, MA 01603</p>
              <a href={directionsUrl} target="_blank" rel="noopener">
                Get directions →
              </a>
            </article>
            <article>
              <span>Hours</span>
              <dl className="hours-list">
                <div>
                  <dt>Mon–Fri</dt>
                  <dd>10:00 AM–4:00 PM</dd>
                </div>
                <div>
                  <dt>Saturday</dt>
                  <dd>By appointment</dd>
                </div>
                <div>
                  <dt>Sunday</dt>
                  <dd>Closed</dd>
                </div>
              </dl>
            </article>
            <article>
              <span>Contact</span>
              <h3>
                <a href="tel:+15088269405">(508) 826-9405</a>
              </h3>
              <p>
                <a
                  className="email-link"
                  href="mailto:smpaulino.business@gmail.com"
                >
                  smpaulino.business@gmail.com
                </a>
              </p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
