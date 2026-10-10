import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { InventoryReadOnlyError, readInventorySnapshot } from "@/lib/inventory";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isInventoryPhotoBlobOriginUrl } from "@/lib/inventory-photos";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { validAdminMutation } from "@/lib/admin-mutation";
import { getRedis } from "@/lib/redis";
import { canonicalInventoryPhotoUrl, inventoryCleanupClaimScript, inventoryPhotoGraceMs, inventoryPhotoStateKey, inventoryStateKey } from "@/lib/inventory-state";
import { readBoundedJson, RequestBodyError } from "../../../../../security-console/shared/mutation-request";

// Admin-only orphaned blob cleanup. Lists blobs under inventory/photos/ and
// deletes those not referenced by any vehicle. GET returns the orphan list
// (dry run); POST with { confirm: true } deletes them.
async function findOrphans() {
  const { vehicles, revision } = await readInventorySnapshot();
  if (revision === "legacy-read-only") throw new InventoryReadOnlyError();
  const referenced = new Set<string>();
  for (const vehicle of vehicles) {
    for (const photo of vehicle.photos || []) referenced.add(canonicalInventoryPhotoUrl(photo));
  }

  const orphans: Array<{ url: string; size: number }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "inventory/photos/", cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const age = Date.now() - new Date(blob.uploadedAt).getTime();
      if (Number.isFinite(age) && age >= inventoryPhotoGraceMs && !referenced.has(blob.url) && isInventoryPhotoBlobOriginUrl(blob.url)) {
        orphans.push({ url: blob.url, size: blob.size });
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return { orphans, revision };
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { orphans } = await findOrphans();
    return NextResponse.json({
      orphan_count: orphans.length,
      orphan_bytes: orphans.reduce((sum, o) => sum + o.size, 0),
      orphans: orphans.map((o) => o.url),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InventoryReadOnlyError ? error.message : "Unable to list blobs" }, { status: error instanceof InventoryReadOnlyError ? 503 : 500 });
  }
}

export async function POST(request: Request) {
  const context = securityRequestContext(request, true);
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const body = await readBoundedJson(request, 1024) as { confirm?: unknown };
    if (body.confirm !== true) {
      return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    }
    const { orphans, revision } = await findOrphans();
    const redis = getRedis(); if (!redis) throw new InventoryReadOnlyError();
    // Claims and inventory-reference checks share the catalog's atomic store.
    // Writers reject a deleting/deleted URL, closing the reattachment race.
    const candidates = [...new Set(orphans.map(o => o.url))].slice(0, 100);
    const claims = candidates.length ? await redis.eval(inventoryCleanupClaimScript,
      [inventoryStateKey, ...candidates.map(inventoryPhotoStateKey)], [revision, JSON.stringify(candidates)]) : [];
    if (!Array.isArray(claims) || claims.some(url => typeof url !== "string" || !candidates.includes(url))) throw new Error("Invalid cleanup claim");
    const urls = claims as string[];
    if (urls.length) await del(urls);
    for (const url of urls) await redis.set(inventoryPhotoStateKey(url), "deleted");
    const deleted = new Set(urls);
    const bytes = orphans.filter(o => deleted.has(o.url)).reduce((sum, o) => sum + o.size, 0);
    await writeSecurityEvent({
      ...context,
      event: "inventory.mutation",
      outcome: "allowed",
      actor: "admin",
      reason: "orphan_blobs_cleaned",
      metadata: { blobs_deleted: urls.length, bytes_freed: bytes },
    });
    return NextResponse.json({ deleted: urls.length, bytes_freed: bytes });
  } catch (error) {
    await writeSecurityEvent({
      ...context,
      event: "inventory.mutation",
      outcome: "failed",
      actor: "admin",
      reason: "orphan_cleanup_failed",
      metadata: { failure_class: error instanceof Error ? (error.constructor?.name || error.name) : "UnknownError" },
    });
    return NextResponse.json({ error: error instanceof RequestBodyError || error instanceof InventoryReadOnlyError ? error.message : "Cleanup failed" },
      { status: error instanceof RequestBodyError ? error.status : error instanceof InventoryReadOnlyError ? 503 : 500 });
  }
}
