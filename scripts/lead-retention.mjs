import { pathToFileURL } from "node:url";
import { list, del } from "@vercel/blob";

const leadPath = /^leads\/test-drive\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

// Dry run unless --apply is explicitly supplied. Only UUID-named test-drive
// records qualify; never fetch or print customer data, tokens, or private URLs.
export async function runRetention({ days, apply = false, token, storeId, now = Date.now() }, api = { list, del }) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("--days must be an integer from 1 to 3650");
  if (!token || !/^store_[A-Za-z0-9]+$/.test(storeId ?? "")) throw new Error("Set Test_Drive and Test_Drive_STORE_ID securely in the environment");
  const cutoff = now - days * 86_400_000;
  const candidates = [];
  const seenCursors = new Set();
  let cursor;
  do {
    const page = await api.list({ token, storeId, prefix: "leads/test-drive/", limit: 1000, cursor });
    for (const blob of page.blobs) {
      if (leadPath.test(blob.pathname) && new Date(blob.uploadedAt).getTime() < cutoff) {
        candidates.push(blob.pathname);
      }
    }
    if (!page.hasMore) break;
    if (!page.cursor || seenCursors.has(page.cursor)) throw new Error("Invalid storage pagination; no records deleted");
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (true);
  const unique = [...new Set(candidates)];
  if (apply) {
    // Finish and validate listing before the first delete. Small batches keep
    // the operation bounded; a failure is reported, never retried silently.
    for (let offset = 0; offset < unique.length; offset += 100) {
      await api.del(unique.slice(offset, offset + 100), { token, storeId });
    }
  }
  return { mode: apply ? "applied" : "dry-run", storeId, cutoff: new Date(cutoff).toISOString(), records: unique.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const knownArgs = daysIndex >= 0 ? args.filter((_, index) => index !== daysIndex && index !== daysIndex + 1) : args;
  try {
    if (knownArgs.some((arg) => arg !== "--apply")) throw new Error("Usage: node scripts/lead-retention.mjs --days <retention-days> [--apply]");
    // Explicit token authentication, so an inherited Vercel deployment identity
    // cannot silently select a different credential or store.
    delete process.env.VERCEL_OIDC_TOKEN;
    console.log(JSON.stringify(await runRetention({
      days: Number(args[daysIndex + 1]), apply: args.includes("--apply"),
      token: process.env.Test_Drive, storeId: process.env.Test_Drive_STORE_ID,
    })));
  } catch {
    console.error("Lead retention failed. Check arguments, storage configuration and permissions. An interrupted --apply may have deleted some eligible records; rerun a dry run to inspect the remaining count.");
    process.exitCode = 1;
  }
}
