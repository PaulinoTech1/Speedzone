// Appends one anchor per closed hourly window, catching up missed hours.
// Usage: node scripts/log-anchors/anchor.mjs   (env: AXIOM_QUERY_TOKEN, AXIOM_QUERY_URL or AXIOM_DATASET)
import { appendFileSync, mkdirSync } from "node:fs";
import { config, fetchWindow, windowDigest, anchorHash, readAnchors } from "./lib.mjs";

const HOUR = 3600_000, LAG = 15 * 60_000, MAX_PER_RUN = 48;
const GENESIS = "0".repeat(64);

export async function run({ now = Date.now(), fetchImpl, dir = process.env.ANCHOR_DIR || "anchors" } = {}) {
  const cfg = config();
  if (!cfg.token || !cfg.url) {
    console.log("::warning::AXIOM_QUERY_TOKEN secret or AXIOM_QUERY_URL/AXIOM_DATASET variable is not set; no anchor written. See README.");
    return 0;
  }
  const anchors = readAnchors(dir);
  const last = anchors.at(-1);
  const closedUntil = Math.floor((now - LAG) / HOUR) * HOUR;
  let start = last ? Date.parse(last.windowEnd) : closedUntil - HOUR;
  let prev = last ? last.anchor : GENESIS;
  let written = 0;
  mkdirSync(dir, { recursive: true });
  while (start + HOUR <= closedUntil && written < MAX_PER_RUN) {
    const end = start + HOUR;
    const digest = windowDigest(await fetchWindow(start, end, { ...cfg, fetchImpl }));
    const record = { v: 1, windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(), ...digest, prevAnchor: prev, generatedAt: new Date(now).toISOString() };
    record.anchor = anchorHash(record);
    appendFileSync(`${dir}/${record.windowStart.slice(0, 7)}.jsonl`, JSON.stringify(record) + "\n");
    console.log(`anchored ${record.windowStart} count=${record.count} invalid=${record.invalid}`);
    prev = record.anchor; start = end; written++;
  }
  if (!written) console.log("no new closed window");
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
