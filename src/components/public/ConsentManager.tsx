"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { consentStorageKey, metaPixelScriptUrl, parseConsent, shouldLoadPixel, type ConsentChoice } from "@/lib/meta-pixel-config";

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: (...args: unknown[]) => void };
declare global { interface Window { fbq?: Fbq; _fbq?: Fbq } }

function loadPixel(pixelId: string) {
  if (window.fbq) return;
  // Equivalent of Meta's base snippet, written as module code so no inline
  // script is needed. The external script is permitted by 'strict-dynamic'
  // because this trusted, nonce'd bundle inserts it.
  const fbq: Fbq = (...args: unknown[]) => { if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue!.push(args); };
  fbq.queue = []; fbq.loaded = true; fbq.version = "2.0"; fbq.push = fbq;
  window.fbq = fbq; window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true; script.src = metaPixelScriptUrl;
  document.head.appendChild(script);
  fbq("init", pixelId);
  fbq("track", "PageView");
}

function readStoredConsent(): ConsentChoice | null {
  try { return parseConsent(window.localStorage.getItem(consentStorageKey)); } catch { return null; /* storage blocked: no consent */ }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Rendered only when the Pixel flag is on. Default is no consent and no Pixel. */
export default function ConsentManager({ pixelId }: { pixelId: string }) {
  // "server" during SSR/hydration so the banner never flashes or mismatches.
  const stored = useSyncExternalStore(subscribe, readStoredConsent, () => "server" as const);
  const [override, setOverride] = useState<ConsentChoice | null>(null);
  const [open, setOpen] = useState(false);
  const ready = stored !== "server";
  const choice = override ?? (ready ? stored : null);
  useEffect(() => { if (shouldLoadPixel({ pixelId }, choice)) loadPixel(pixelId); }, [choice, pixelId]);

  function decide(next: ConsentChoice) {
    try { window.localStorage.setItem(consentStorageKey, next); } catch { /* choice applies to this page only */ }
    const revoking = choice === "granted" && next === "denied";
    setOverride(next); setOpen(false);
    // A loaded Pixel cannot be unloaded; reload so it is gone.
    if (revoking) window.location.reload();
  }

  if (!ready) return null;
  if (choice && !open) return <button type="button" className="consent-reopen" onClick={() => setOpen(true)}>Privacy choices</button>;
  return (
    <section className="consent-banner" role="dialog" aria-labelledby="consent-title" aria-live="polite">
      <h2 id="consent-title">Advertising cookies</h2>
      <p>With your permission we use the Meta Pixel to measure our Facebook and Instagram ads. It is off unless you accept. See our <a href="/privacy">privacy policy</a>.</p>
      <div className="consent-actions">
        <button type="button" className="button button-secondary" onClick={() => decide("denied")}>Decline</button>
        <button type="button" className="button button-primary" onClick={() => decide("granted")}>Accept</button>
      </div>
    </section>
  );
}
