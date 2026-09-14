"use client";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main className="shell legal-main"><h1>This page is temporarily unavailable</h1><p>Please try again. If the problem continues, send a private report with the page and time it happened.</p><button className="button button-primary" onClick={retry}>Try again</button><p><a href="/report-a-problem">Report a problem</a></p></main>;
}
