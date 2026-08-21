/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

type SiteChromeProps = {
  currentPage?: "home" | "road-trip" | "inventory";
};

const directionsUrl =
  "https://maps.google.com/?q=1094+Main+St+Worcester+MA+01603";

export function SiteHeader({ currentPage = "home" }: SiteChromeProps) {
  const onHome = currentPage === "home";
  const prefix = onHome ? "" : "/";

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="site-header">
        <div className="utility-bar">
          <div className="shell utility-inner">
            <a href="tel:+15088269405">(508) 826-9405</a>
            <a href={directionsUrl} target="_blank" rel="noopener">
              1094 Main St, Worcester, MA
            </a>
            <span>Mon–Fri 10–4 · Sat by appointment</span>
          </div>
        </div>

        <div className="shell brand-row">
          <a
            className="brand"
            href={onHome ? "#top" : "/"}
            aria-label="SpeedZone Motorsports home"
          >
            <img
              src="/assets/speedzone-logo-v1.png"
              width="64"
              height="64"
              alt="SpeedZone Motorsports"
              fetchPriority="high"
            />
            <span className="brand-name">
              <strong>SpeedZone</strong>
              <small>Motorsports</small>
            </span>
          </a>
          <a className="header-call" href="tel:+15088269405">
            Call now
          </a>
        </div>

        <nav className="mobile-nav" aria-label="Primary navigation">
          <div className="shell nav-track">
            <a
              href={onHome ? "#inventory" : "/inventory"}
              aria-current={currentPage === "inventory" ? "page" : undefined}
            >
              Inventory
            </a>
            <a href={`${prefix}#about`}>Our story</a>
            <a
              href="/road-trip"
              aria-current={currentPage === "road-trip" ? "page" : undefined}
            >
              Road Trip
            </a>
            <a href={`${prefix}#why-us`}>Why SpeedZone</a>
            <a href={`${prefix}#maintenance`}>Car care</a>
            <a href={`${prefix}#contact`}>Visit us</a>
          </div>
        </nav>
      </header>
    </>
  );
}

export function SiteFooter({ currentPage = "home" }: SiteChromeProps) {
  const onHome = currentPage === "home";

  return (
    <>
      <footer className="site-footer">
        <div className="shell footer-grid">
          <div>
            <a
              className="brand footer-brand"
              href={onHome ? "#top" : "/"}
              aria-label="SpeedZone Motorsports home"
            >
              <img
                src="/assets/speedzone-logo-v1.png"
                width="48"
                height="48"
                alt=""
                loading="lazy"
              />
              <span className="brand-name">
                <strong>SpeedZone</strong>
                <small>Motorsports</small>
              </span>
            </a>
            <p>
              Worcester’s destination for quality, affordable used cars since
              2010.
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <h2>Explore</h2>
            {onHome ? (
              <>
                <a href="#inventory">Latest arrivals</a>
                <a href="/inventory">Browse inventory</a>
                <a href="#about">Our story</a>
                <a href="/road-trip">Road Trip</a>
                <a href="#maintenance">Car care</a>
                <a href="#contact">Visit us</a>
              </>
            ) : (
              <>
                <a href="/">Home</a>
                <a href="/inventory" aria-current={currentPage === "inventory" ? "page" : undefined}>
                  Inventory
                </a>
                <a href="/road-trip" aria-current="page">
                  Road Trip
                </a>
                <a href="/#maintenance">Car care</a>
                <a href="/#contact">Visit us</a>
              </>
            )}
          </nav>

          <div>
            <h2>Follow</h2>
            <a
              href="https://www.instagram.com/speedzone_motorsports/"
              target="_blank"
              rel="noopener"
            >
              Instagram
            </a>
            <a
              href="https://share.google/NaPjBJWLlkGfHci1J"
              target="_blank"
              rel="noopener"
            >
              Google reviews
            </a>
          </div>
        </div>

        <div className="shell footer-bottom">
          <p>© 2026 SpeedZone Motorsports. All rights reserved.</p>
          <div>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
      </footer>

      <nav className="mobile-dock" aria-label="Quick contact">
        <a href="tel:+15088269405">
          <span>Call</span>
          <strong>(508) 826-9405</strong>
        </a>
        <a href={directionsUrl} target="_blank" rel="noopener">
          <span>Visit</span>
          <strong>Get directions</strong>
        </a>
      </nav>
    </>
  );
}

export function LegalHeader() {
  return (
    <header className="subpage-header">
      <div className="shell brand-row">
        <a className="brand" href="/" aria-label="SpeedZone Motorsports home">
          <img
            src="/assets/speedzone-logo-v1.png"
            width="64"
            height="64"
            alt="SpeedZone Motorsports"
          />
          <span className="brand-name">
            <strong>SpeedZone</strong>
            <small>Motorsports</small>
          </span>
        </a>
        <a className="header-call subpage-back" href="/">
          Back home
        </a>
      </div>
    </header>
  );
}

export function LegalFooter({ counterpart }: { counterpart: "privacy" | "terms" }) {
  return (
    <footer className="site-footer legal-footer">
      <div className="shell footer-bottom">
        <p>© 2026 SpeedZone Motorsports.</p>
        <div>
          <a href="/">Home</a>
          <a href={`/${counterpart}`}>
            {counterpart === "privacy" ? "Privacy" : "Terms"}
          </a>
        </div>
      </div>
    </footer>
  );
}
