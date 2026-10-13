// Shared, dependency-free helpers. Mirrors canonical() and hashSecurityEvent()
// in src/lib/security-events.ts exactly.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([k]) => k !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

const isEvent = (e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.hash === "string" && /^[0-9a-f]{64}$/.test(e.hash) && (e.version === 1 || e.version === 2);

// Root over the window's events: count line, then "id hash" lines sorted by id
// (byte order, then hash, so duplicates are deterministic). Event contents are
// never stored; only this digest.
export function windowDigest(rows) {
  const events = rows.map((r) => (r && typeof r === "object" && "data" in r ? r.data : r)).filter(isEvent);
  const lines = events.map((e) => `${e.id} ${e.hash}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const invalid = events.filter((e) => sha256(canonical(e)) !== e.hash).length;
  return { count: lines.length, invalid, root: sha256(`speedzone-anchor-v1\n${lines.length}\n${lines.join("\n")}\n`) };
}

export function anchorHash(record) {
  const rest = { ...record };
  delete rest.anchor;
  return sha256(canonical(rest));
}

export function readAnchors(dir = "anchors") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort()
    .flatMap((f) => readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

export function config() {
  const url = process.env.AXIOM_QUERY_URL?.trim() || (process.env.AXIOM_DATASET ? `https://api.axiom.co/v1/datasets/${encodeURIComponent(process.env.AXIOM_DATASET.trim())}/query` : "");
  const token = process.env.AXIOM_QUERY_TOKEN?.trim();
  return { url, token };
}

const LIMIT = 10000;
// Read-only legacy dataset query, same endpoint shape the security console uses.
// Windows that hit the row limit are split in half until each part fits.
export async function fetchWindow(start, end, { url, token, fetchImpl = fetch }) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/^\/v1\/datasets\/[^/]+\/query$/.test(u.pathname)) throw new Error("AXIOM_QUERY_URL must be https://…/v1/datasets/DATASET/query");
  const res = await fetchImpl(u, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), limit: LIMIT, order: [{ field: "_time", desc: false }] }) });
  if (!res.ok) throw new Error(`Axiom query failed with HTTP ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : body.matches ?? body.events ?? [];
  if (rows.length >= LIMIT) {
    const mid = start + Math.floor((end - start) / 2);
    if (mid <= start) throw new Error("window too dense to split");
    return [...(await fetchWindow(start, mid, { url, token, fetchImpl })), ...(await fetchWindow(mid, end, { url, token, fetchImpl }))];
  }
  return rows;
}
