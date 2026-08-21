/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

export default function NotFound() {
  return (
    <main className="error-page">
      <div className="shell error-content">
        <a className="brand error-brand" href="/" aria-label="SpeedZone Motorsports home">
          <img
            src="/assets/speedzone-logo-v1.png"
            width="96"
            height="96"
            alt="SpeedZone Motorsports"
          />
        </a>
        <p className="error-code">404</p>
        <h1>This road ends here.</h1>
        <p>The page you were looking for isn’t available.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/">
            Back to SpeedZone
          </a>
          <a className="button button-ghost" href="tel:+15088269405">
            Call us
          </a>
        </div>
      </div>
    </main>
  );
}
