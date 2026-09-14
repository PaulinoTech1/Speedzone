import type { ReactNode } from "react";

import { LegalFooter, LegalHeader } from "./SiteChrome";

export function LegalPageShell({
  title,
  counterpart,
  updated = "August 20, 2026",
  children,
}: {
  title: string;
  updated?: string;
  counterpart: "privacy" | "terms";
  children: ReactNode;
}) {
  return (
    <div className="subpage">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <LegalHeader />
      <main className="legal-main" id="main">
        <article className="shell legal-copy">
          <p className="section-kicker">Site information</p>
          <h1>{title}</h1>
          <p className="legal-updated">Updated {updated}</p>
          {children}
        </article>
      </main>
      <LegalFooter counterpart={counterpart} />
    </div>
  );
}
