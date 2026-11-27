import { revalidatePath, revalidateTag } from "next/cache";

import { INVENTORY_CACHE_TAG } from "@/lib/public-cache";

/**
 * Purge every cached public page that shows inventory: home, /inventory, all
 * vehicle detail pages (tagged sz-inventory via Vercel-Cache-Tag) and the
 * sitemap (ISR). Expiring immediately means the next visitor gets fresh data.
 * Failure to purge must never fail the admin write; the 300s TTL bounds staleness.
 */
export function invalidatePublicInventory(): void {
  try {
    revalidateTag(INVENTORY_CACHE_TAG, { expire: 0 });
    revalidatePath("/sitemap.xml");
    revalidatePath("/inventory");
    revalidatePath("/inventory/[id]", "page");
    revalidatePath("/");
  } catch (error) {
    console.warn("[public-cache] inventory invalidation failed", error instanceof Error ? error.message : "unknown error");
  }
}
