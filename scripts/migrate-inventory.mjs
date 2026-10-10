// Controlled cutover: deploy the read-only legacy fallback before applying.
// Never initialize authoritative state automatically from a cached delivery URL.
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { put } from "@vercel/blob";

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const path = value("--file");
if (!path) throw new Error("Provide a reviewed JSON export with --file. Default mode validates without writing.");
const bytes = await readFile(path);
if (bytes.length > 512 * 1024) throw new Error("Inventory export exceeds 512 KiB");
const digest = createHash("sha256").update(bytes).digest("hex");
const vehicles = JSON.parse(bytes.toString("utf8"));
if (!Array.isArray(vehicles) || vehicles.length > 500 || vehicles.some(v => !v || typeof v.id !== "string" || !v.id
  || typeof v.make !== "string" || typeof v.model !== "string" || !Number.isInteger(v.year)
  || !Number.isFinite(v.price) || !Number.isFinite(v.mileage) || !Array.isArray(v.photos) || v.photos.length > 24
  || v.photos.some(url => typeof url !== "string"))) throw new Error("Invalid inventory export");
if (new Set(vehicles.map(v => v.id)).size !== vehicles.length) throw new Error("Duplicate listing IDs");
// URL spelling must not create a second identity for the same storage object.
for (const vehicle of vehicles) vehicle.photos = vehicle.photos.map(url => {
  try { return new URL(url).href; } catch { return url; }
});
console.log(JSON.stringify({ listings: vehicles.length, photos: vehicles.reduce((n,v) => n + v.photos.length,0), sha256: digest, apply: args.includes("--apply") }));
if (args.includes("--apply")) {
  if (value("--sha256") !== digest) throw new Error("--sha256 must match the reviewed export");
  if (!vehicles.length && !args.includes("--allow-empty")) throw new Error("An empty inventory requires --allow-empty");
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_URL ? process.env.KV_REST_API_TOKEN : process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Target Redis and Blob credentials are required");
  const redis = new Redis({ url, token });
  const revision = randomUUID(); const document = { version: 2, revision, vehicles };
  await put(`inventory/history/${revision}.json`, JSON.stringify(document), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false });
  const created = await redis.set("speedzone:inventory:catalog:v2", document, { nx: true });
  if (!created) throw new Error("Authoritative inventory already exists; refusing to replace it");
  console.log(JSON.stringify({ initialized: true, revision }));
}
