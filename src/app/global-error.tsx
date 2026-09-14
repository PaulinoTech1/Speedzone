"use client";

export default function GlobalError({ retry }: { retry: () => void }) {
  return <html lang="en"><body><main><h1>The website is temporarily unavailable</h1><p>Please try again shortly.</p><button onClick={retry}>Try again</button><p><a href="/report-a-problem">Report a problem</a></p></main></body></html>;
}
