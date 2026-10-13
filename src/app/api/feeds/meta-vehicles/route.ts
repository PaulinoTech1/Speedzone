import { readInventory } from "@/lib/inventory";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { feedFailuresBlocked, networkKey, recordFeedFailure } from "@/lib/integration-rate-limit";
import { buildVehicleFeedCsv, configuredFeedToken, feedTokenMatches, suppliedFeedToken } from "@/lib/integrations/meta/vehicle-feed";

// no-store + private: Vercel's CDN must never cache and replay the feed to an
// unauthenticated client. Vary covers any intermediary that ignores no-store.
const noStore = { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store", Vary: "Authorization", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
export const dynamic = "force-dynamic";

/** Token-protected Meta vehicle catalog feed. Disabled (404) unless META_FEED_TOKEN is set. */
export async function GET(request: Request) {
  const expected = configuredFeedToken();
  if (!expected) return new Response("Not Found", { status: 404, headers: noStore });
  const key = networkKey(request, "feed");
  const gate = await feedFailuresBlocked(key);
  if (gate.blocked) return new Response("Too Many Requests", { status: 429, headers: { ...noStore, "Retry-After": String(gate.retryAfter) } });
  if (!feedTokenMatches(suppliedFeedToken(request), expected)) {
    await recordFeedFailure(key);
    // Only the pathname is recorded (securityRequestContext); credentials never are.
    await writeSecurityEvent({ ...securityRequestContext(request), event: "inventory.read", outcome: "denied", actor: "anonymous", reason: "catalog_feed_token_rejected" });
    return new Response("Unauthorized", { status: 401, headers: { ...noStore, "WWW-Authenticate": 'Basic realm="catalog-feed", charset="UTF-8"' } });
  }
  try {
    const csv = buildVehicleFeedCsv(await readInventory());
    return new Response(csv, { headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'inline; filename="speedzone-vehicles.csv"' } });
  } catch {
    await writeSecurityEvent({ ...securityRequestContext(request), event: "inventory.read", outcome: "failed", actor: "anonymous", reason: "catalog_feed_unavailable" });
    return new Response("Feed temporarily unavailable", { status: 503, headers: { ...noStore, "Retry-After": "300" } });
  }
}
