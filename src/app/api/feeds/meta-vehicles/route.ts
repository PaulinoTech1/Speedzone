import { readInventory } from "@/lib/inventory";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { buildVehicleFeedCsv, configuredFeedToken, feedTokenMatches, suppliedFeedToken } from "@/lib/integrations/meta/vehicle-feed";

const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" };

/** Token-protected Meta vehicle catalog feed. Disabled (404) unless META_FEED_TOKEN is set. */
export async function GET(request: Request) {
  const expected = configuredFeedToken();
  if (!expected) return new Response("Not Found", { status: 404, headers: noStore });
  if (!feedTokenMatches(suppliedFeedToken(request), expected)) {
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
