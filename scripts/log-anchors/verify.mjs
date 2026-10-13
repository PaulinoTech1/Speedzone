// Verifies the anchor chain offline, and (with a token) recomputes windows from Axiom.
// Usage: node scripts/log-anchors/verify.mjs [--chain-only] [--from ISO] [--to ISO]
import { config, fetchWindow, windowDigest, anchorHash, readAnchors } from "./lib.mjs";

export async function verify({ args = process.argv.slice(2), fetchImpl, dir = process.env.ANCHOR_DIR || "anchors" } = {}) {
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const from = opt("--from") ? Date.parse(opt("--from")) : -Infinity, to = opt("--to") ? Date.parse(opt("--to")) : Infinity;
  const anchors = readAnchors(dir); let bad = 0, prev = "0".repeat(64);
  for (const [i, a] of anchors.entries()) {
    if (anchorHash(a) !== a.anchor) { console.log(`CHAIN  ${a.windowStart} anchor hash mismatch (record edited)`); bad++; }
    if (i > 0 && a.prevAnchor !== prev) { console.log(`CHAIN  ${a.windowStart} prevAnchor does not link to previous record`); bad++; }
    if (i > 0 && a.windowStart !== anchors[i - 1].windowEnd) { console.log(`CHAIN  ${a.windowStart} gap or overlap after ${anchors[i - 1].windowEnd}`); bad++; }
    prev = a.anchor;
  }
  console.log(`chain: ${anchors.length} records, ${bad} problems`);
  if (!args.includes("--chain-only")) {
    const cfg = config();
    if (!cfg.token || !cfg.url) { console.log("AXIOM_QUERY_TOKEN / AXIOM_QUERY_URL not set; skipped recomputation"); return bad; }
    for (const a of anchors.filter((a) => Date.parse(a.windowStart) >= from && Date.parse(a.windowEnd) <= to)) {
      const d = windowDigest(await fetchWindow(Date.parse(a.windowStart), Date.parse(a.windowEnd), { ...cfg, fetchImpl }));
      const ok = d.root === a.root && d.count === a.count;
      if (!ok) bad++;
      console.log(`${ok ? "OK    " : "TAMPER"} ${a.windowStart} anchored count=${a.count} now count=${d.count}${d.invalid ? ` invalid-event-hashes=${d.invalid}` : ""}`);
    }
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) verify().then((b) => process.exit(b ? 1 : 0), (e) => { console.error(e.message); process.exit(2); });
