// Synthetic-fixture test. No network, no real token. Run: node test/run.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { canonical, sha256, windowDigest } from "./lib.mjs";
import { run } from "./anchor.mjs";
import { verify } from "./verify.mjs";

const mk = (i, t) => { const e = { version: 2, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, requestId: `req_${i}abcdefg`, occurredAt: new Date(t).toISOString(), event: "admin.login", outcome: "success", actor: "admin", route: "/api/admin/login", method: "POST", metadata: { n: i, ok: true } }; return { ...e, hash: sha256(canonical(e)) }; };
const H = 3600_000, base = Date.parse("2026-10-13T10:00:00Z");
let store = Array.from({ length: 30 }, (_, i) => ({ _time: new Date(base + i * 7 * 60_000).toISOString(), data: mk(i, base + i * 7 * 60_000) }));
const fetchImpl = async (_u, init) => { const q = JSON.parse(init.body); const s = Date.parse(q.startTime), e = Date.parse(q.endTime);
  return { ok: true, json: async () => ({ matches: store.filter((r) => { const t = Date.parse(r._time); return t >= s && t < e; }).reverse() }) }; };

// Order independence and event-hash check.
const a = windowDigest(store.map((r) => r.data)), b = windowDigest([...store].reverse().map((r) => r.data));
assert.equal(a.root, b.root); assert.equal(a.invalid, 0);

const dir = mkdtempSync(`${tmpdir()}/anch-`);
process.env.AXIOM_QUERY_TOKEN = ""; process.env.AXIOM_QUERY_URL = "";
assert.equal(await run({ now: base + 4 * H, fetchImpl, dir }), 0, "missing secret writes nothing");

process.env.AXIOM_QUERY_TOKEN = "synthetic"; process.env.AXIOM_QUERY_URL = "https://api.axiom.co/v1/datasets/fixture/query";
assert.equal(await run({ now: base + H + 20 * 60_000, fetchImpl, dir }), 1);   // anchors 10:00-11:00
assert.equal(await run({ now: base + H + 50 * 60_000, fetchImpl, dir }), 0);   // 11:00 window not closed (lag)
assert.equal(await run({ now: base + 4 * H + 16 * 60_000, fetchImpl, dir }), 3); // catches up 11,12,13
const lines = readFileSync(`${dir}/2026-10.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.equal(lines.length, 4); assert.equal(lines[0].count, 9); assert.equal(lines.reduce((s, l) => s + l.count, 0), 30);
assert.ok(!JSON.stringify(lines).includes("admin.login"), "no event contents stored");
assert.equal(await verify({ args: [], fetchImpl, dir }), 0);

store = store.filter((_, i) => i !== 3);                                         // delete one event in Axiom
assert.equal(await verify({ args: [], fetchImpl, dir }), 1);
store[4].data = { ...store[4].data, outcome: "failure" };                        // edit event, hash left stale
assert.ok(windowDigest(store.map((r) => r.data)).invalid === 1);

const f = `${dir}/2026-10.jsonl`, rows = readFileSync(f, "utf8").trim().split("\n");
const r1 = JSON.parse(rows[1]); r1.count = 99; rows[1] = JSON.stringify(r1); writeFileSync(f, rows.join("\n") + "\n");
assert.ok(await verify({ args: ["--chain-only"], dir }) >= 1, "edited anchor detected");
console.log("all anchor tests passed");
