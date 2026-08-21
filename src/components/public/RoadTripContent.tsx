/* eslint-disable @next/next/no-html-link-for-pages */

type Destination = {
  cost: string;
  place: string;
  name: string;
  description: string;
  planning: string;
  url: string;
  linkLabel?: string;
};

const centralMass: Destination[] = [
  {
    cost: "Free",
    place: "Spencer",
    name: "Spencer State Forest",
    description:
      "Follow woodland and river trails, bring lunch to the Howe Pond picnic area, and make an easy nature day close to Worcester.",
    planning:
      "Open sunrise to sunset. Onsite parking is free, and restrooms are available.",
    url: "https://www.mass.gov/locations/spencer-state-forest",
  },
  {
    cost: "Free",
    place: "West Boylston",
    name: "Wachusett Reservoir",
    description:
      "Take an easy walk with wide reservoir views, see the dam and North Dike, and visit the Old Stone Church.",
    planning:
      "Open from one hour before sunrise to one hour after sunset. Use designated parking and never block a gate. No dogs, swimming, boating, fires, or drones.",
    url: "https://www.mass.gov/locations/wachusett-reservoir",
  },
  {
    cost: "Free",
    place: "Uxbridge",
    name: "River Bend Farm",
    description:
      "Walk beside the Blackstone Canal, explore farm-to-factory history, picnic, bike, fish, or launch a canoe or kayak.",
    planning:
      "Parking, admission, and public programs are free. The park is open sunrise to sunset; the visitor center is generally open daily 8:30–4.",
    url: "https://www.mass.gov/locations/blackstone-river-and-canal-heritage-state-park",
  },
  {
    cost: "Free",
    place: "Fitchburg",
    name: "Fitchburg Art Museum",
    description:
      "Make an indoor art stop manageable for little legs with family guidance, learning spaces, and hands-on resources.",
    planning:
      "Admission and museum parking are free. The museum is open Wednesday through Sunday with shorter weekday hours; check the calendar for holiday closings.",
    url: "https://fitchburgartmuseum.org/visit/",
  },
  {
    cost: "$5 MA parking",
    place: "Sutton",
    name: "Purgatory Chasm",
    description:
      "Climb around dramatic rock formations, choose from two miles of trails, then use the playground and picnic area.",
    planning:
      "Seasonal parking is $5 per Massachusetts vehicle and $20 for an out-of-state vehicle. The Chasm Trail closes in winter; stay off wet rocks and away from edges.",
    url: "https://www.mass.gov/locations/purgatory-chasm-state-reservation",
  },
  {
    cost: "Free lots available",
    place: "Princeton",
    name: "Wachusett Mountain",
    description:
      "Hike family-friendly trails or take the seasonal summit road for a big 360-degree view and a picnic.",
    planning:
      "Perimeter roadside lots are free. Seasonal interior parking and the summit road cost $5 per Massachusetts vehicle or $20 out of state. The summit road typically runs Memorial Day weekend through late October.",
    url: "https://www.mass.gov/locations/wachusett-mountain-state-reservation",
  },
  {
    cost: "Kids free",
    place: "Clinton",
    name: "Icon Museum",
    description:
      "Use an all-ages scavenger hunt and magnifying glasses to explore art from Russian, Greek, and Ethiopian traditions.",
    planning:
      "Youth 17 and under and students are free; adults are $15 and seniors $12. Everyone visits free on the first Sunday each month. Open Thursday–Sunday, 10–4.",
    url: "https://www.iconmuseum.org/plan-your-visit/",
  },
  {
    cost: "Free",
    place: "Belchertown",
    name: "Quabbin Reservoir",
    description:
      "Find big-water views, scenic lookouts, picnic areas, walks, wildlife displays, and local history exhibits.",
    planning:
      "Parking and admission are free. Vehicle closing times change seasonally. The observation tower is closed for renovation, and dogs are prohibited—even inside parked cars.",
    url: "https://www.mass.gov/locations/quabbin-reservoir",
  },
];

const bostonArea: Destination[] = [
  {
    cost: "Free",
    place: "Boston",
    name: "Arnold Arboretum",
    description:
      "Turn a walk through 281 acres into a family nature hunt with self-guided kid activities and short routes.",
    planning:
      "The landscape is free and open sunrise to sunset. Free street parking is available along Arborway, Flora Way, and Walter Street, but popular events can fill spaces.",
    url: "https://arboretum.harvard.edu/visit/",
  },
  {
    cost: "Free",
    place: "Boston",
    name: "Castle Island",
    description:
      "Pack a picnic for a harbor walk, playground and beach day, then circle historic Fort Independence.",
    planning:
      "Admission and the lot near the fort are free. Fort tours, lifeguards, and some facilities are seasonal or weather dependent. Dogs are not allowed on beaches May 1–September 15.",
    url: "https://www.mass.gov/locations/castle-island-pleasure-bay-m-street-beach-and-carson-beach",
  },
  {
    cost: "Free",
    place: "Lincoln + Concord",
    name: "Minute Man National Park",
    description:
      "Walk part of Battle Road, explore Revolutionary War exhibits, watch a short film, and earn a Junior Ranger badge.",
    planning:
      "No entrance pass is required. Grounds are open sunrise to sunset, but visitor centers, exhibits, and programs follow seasonal schedules.",
    url: "https://www.nps.gov/mima/planyourvisit/index.htm",
  },
  {
    cost: "Free",
    place: "Chestnut Hill",
    name: "Waterworks Museum",
    description:
      "Stand beside enormous historic pumping engines and learn how clean water reached Boston—great for a rainy day.",
    planning:
      "General admission is free. Open Wednesday–Sunday, 11–4. The museum has only 20 designated parking spaces; special-access tours cost extra.",
    url: "https://waterworksmuseum.org/visit/",
  },
  {
    cost: "$3 parking",
    place: "Carlisle",
    name: "Great Brook Farm",
    description:
      "Meet the cows on a free weekend dairy-farm tour, then choose from more than 20 miles of fields and woodland trails.",
    planning:
      "Park entry and tours are free; vehicle parking is $3 from April 1–November 30. Tours are seasonal, and ice cream or winter ski passes cost extra.",
    url: "https://www.mass.gov/locations/great-brook-farm-state-park",
  },
  {
    cost: "Ship free",
    place: "Charlestown",
    name: "USS Constitution",
    description:
      "Board “Old Ironsides,” meet active-duty sailors, then try hands-on maritime exhibits in the museum next door.",
    planning:
      "The ship is free and generally open Tuesday–Sunday, 10–6. Adults 18+ need a physical government photo ID; security screening is required and strollers cannot go aboard. The museum uses suggested admission, and nearby parking may cost extra.",
    url: "https://www.navy.mil/USS-Constitution/Hours-Visitor-Info/index.html",
    linkLabel: "Official ship details",
  },
  {
    cost: "Free",
    place: "Boston Seaport",
    name: "Boston Fire Museum",
    description:
      "Explore antique engines inside an 1891 firehouse and let kids try the interactive telegraph fire-alarm display.",
    planning:
      "Admission is free; donations are welcome. The museum is open Saturdays only, 10–4. Street parking is limited and nearby garages charge a fee.",
    url: "https://www.bostonsparks.com/visit-us",
  },
  {
    cost: "Free",
    place: "Milton",
    name: "Houghton’s Pond",
    description:
      "Mix a beach, playground, picnic, accessible marsh boardwalk, and family trails into one no-admission day.",
    planning:
      "Admission and parking are free. Lots can fill early and close at 8 p.m. Lifeguards are seasonal; flotation devices and dogs are not allowed on the beach.",
    url: "https://www.mass.gov/locations/houghtons-pond-recreation-area",
  },
];

function TripCard({ destination }: { destination: Destination }) {
  return (
    <article className="trip-card">
      <div className="trip-card-top">
        <span className="cost-badge">{destination.cost}</span>
        <span className="trip-place">{destination.place}</span>
      </div>
      <h3>{destination.name}</h3>
      <p>{destination.description}</p>
      <details>
        <summary>Plan this stop</summary>
        <p>{destination.planning}</p>
      </details>
      <a
        className="trip-link"
        href={destination.url}
        target="_blank"
        rel="noopener"
      >
        {destination.linkLabel ?? "Official details"}{" "}
        <span aria-hidden="true">→</span>
      </a>
    </article>
  );
}

function TripRegion({
  id,
  eyebrow,
  title,
  subtitle,
  destinations,
  alternate = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  destinations: Destination[];
  alternate?: boolean;
}) {
  const titleId = id === "central-mass" ? "central-title" : "boston-title";

  return (
    <section
      className={`section trip-region${alternate ? " trip-region-alt" : ""}`}
      id={id}
      aria-labelledby={titleId}
    >
      <div className="shell">
        <div className="trip-heading">
          <div>
            <p className="section-kicker">{eyebrow}</p>
            <h2 id={titleId}>
              {title}
              <br />
              <span>{id === "central-mass" ? "Massachusetts." : "area."}</span>
            </h2>
          </div>
          <p>{subtitle}</p>
        </div>
        <div className="trip-grid">
          {destinations.map((destination) => (
            <TripCard destination={destination} key={destination.name} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function RoadTripContent() {
  return (
    <main id="main">
      <section className="road-hero" aria-labelledby="road-title">
        <div className="shell road-hero-inner">
          <p className="eyebrow">
            <span className="flag" aria-hidden="true" /> Start in Worcester
          </p>
          <h1 id="road-title">Road Trip</h1>
          <p className="road-lead">
            Family fun does not need a theme-park budget. Load up the car and
            explore these free and low-cost day trips across Central
            Massachusetts and the Boston area.
          </p>
          <ul className="road-facts" aria-label="Road Trip guide highlights">
            <li>16 family stops</li>
            <li>Free + low-cost picks</li>
            <li>Official links included</li>
          </ul>
          <nav className="region-links" aria-label="Jump to a region">
            <a className="button button-primary" href="#central-mass">
              Central Massachusetts
            </a>
            <a className="button button-ghost" href="#boston-area">
              Boston area
            </a>
          </nav>
        </div>
      </section>

      <aside className="shell trip-smart" aria-labelledby="trip-smart-title">
        <div>
          <p className="section-kicker">Make the day cost less</p>
          <h2 id="trip-smart-title">
            Pack more fun.
            <br />
            <span>Spend less.</span>
          </h2>
        </div>
        <ul>
          <li>
            <strong>Bring the basics.</strong> Pack water, snacks, sunscreen,
            and a change of clothes.
          </li>
          <li>
            <strong>Check before you leave.</strong> Weather, seasonal hours,
            parking, and programs can change.
          </li>
          <li>
            <strong>Plan Boston parking.</strong> A free attraction can still
            become an expensive day if you use a downtown garage.
          </li>
        </ul>
      </aside>

      <TripRegion
        id="central-mass"
        eyebrow="Close to home"
        title="Central"
        subtitle="Outdoor adventures, local history, and rainy-day art stops—all practical drives from Worcester."
        destinations={centralMass}
      />

      <TripRegion
        id="boston-area"
        eyebrow="City + nearby"
        title="Boston"
        subtitle="History, beaches, nature, and hands-on museums that leave more room in the budget for lunch."
        destinations={bostonArea}
        alternate
      />

      <section className="road-note" aria-labelledby="road-note-title">
        <div className="shell road-note-inner">
          <div>
            <p className="section-kicker">Before you roll</p>
            <h2 id="road-note-title">One last check.</h2>
          </div>
          <p>
            Costs, access details, and hours were checked against official
            sources on August 20, 2026. Conditions change, so open the official
            link before leaving—especially for seasonal programs, parking,
            weather closures, and ID rules.
          </p>
          <a className="button button-primary" href="/#maintenance">
            Check the car-care tips
          </a>
        </div>
      </section>
    </main>
  );
}
