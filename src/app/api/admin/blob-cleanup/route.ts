import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { readInventorySnapshot } from "@/lib/inventory";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isInventoryPhotoBlobOriginUrl } from "@/lib/inventory-photos";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

// Admin-only orphaned blob cleanup. Lists blobs under inventory/photos/ and
// deletes those not referenced by any vehicle. GET returns the orphan list
// (dry run); POST with { confirm: true } deletes them.
async function findOrphans() {
  const { vehicles } = await readInventorySnapshot();
  const referenced = new Set<string>();
  for (const vehicle of vehicles) {
    for (const photo of vehicle.photos || []) referenced.add(photo);
  }

  const orphans: Array<{ url: string; size: number }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "inventory/photos/", cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!referenced.has(blob.url) && isInventoryPhotoBlobOriginUrl(blob.url)) {
        orphans.push({ url: blob.url, size: blob.size });
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return orphans;
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const orphans = await findOrphans();
    return NextResponse.json({
      orphan_count: orphans.length,
      orphan_bytes: orphans.reduce((sum, o) => sum + o.size, 0),
      orphans: orphans.map((o) => o.url),
    });
  } catch {
    return NextResponse.json({ error: "Unable to list blobs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = securityRequestContext(request, true);
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({})) as { confirm?: unknown };
    if (body.confirm !== true) {
      return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    }
    const orphans = await findOrphans();
    const urls = orphans.map((o) => o.url);
    if (urls.length) await del(urls);
    const bytes = orphans.reduce((sum, o) => sum + o.size, 0);
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
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
