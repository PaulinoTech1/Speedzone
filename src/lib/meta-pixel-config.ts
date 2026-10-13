/**
 * Meta Pixel feature flag. Disabled unless BOTH:
 *   META_PIXEL_ENABLED=enabled   (exact value; anything else is off)
 *   META_PIXEL_ID=<digits>       (no ID ships in the repo)
 * Even when enabled, nothing third-party loads until the visitor accepts in
 * the consent banner. Server-only: never read via NEXT_PUBLIC_ variables.
 */
export function metaPixelConfig(env: Record<string, string | undefined> = process.env) {
  if (env.META_PIXEL_ENABLED?.trim() !== "enabled") return null;
  const pixelId = env.META_PIXEL_ID?.trim() ?? "";
  if (!/^\d{8,20}$/.test(pixelId)) return null;
  return { pixelId };
}

/** Origins the Pixel needs beyond what CSP already allows (img-src permits https:). */
export const metaPixelConnectSources = ["https://www.facebook.com", "https://connect.facebook.net"] as const;
export const metaPixelScriptUrl = "https://connect.facebook.net/en_US/fbevents.js";

export const consentStorageKey = "speedzone-consent-v1";
export type ConsentChoice = "granted" | "denied";
export const parseConsent = (value: string | null | undefined): ConsentChoice | null => value === "granted" || value === "denied" ? value : null;
/** The single gate: flag on (config present) AND explicit opt-in. */
export const shouldLoadPixel = (config: { pixelId: string } | null, consent: ConsentChoice | null) => !!config && consent === "granted";
