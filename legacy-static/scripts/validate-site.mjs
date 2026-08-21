import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "road-trip.html", "privacy.html", "terms.html", "404.html"];
const failures = [];

const fail = (message) => failures.push(message);

for (const page of pages) {
  const file = join(root, page);
  if (!existsSync(file)) {
    fail(`${page}: file is missing`);
    continue;
  }

  const html = readFileSync(file, "utf8");
  const label = page;

  if (!/^<!doctype html>/i.test(html)) fail(`${label}: missing HTML doctype`);
  if (!/<html lang="en">/i.test(html)) fail(`${label}: missing English language declaration`);
  if (!/<meta name="viewport"/i.test(html)) fail(`${label}: missing viewport metadata`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${label}: missing page title`);
  if (page !== "404.html" && !/<meta name="description" content="[^"]+">/i.test(html)) {
    fail(`${label}: missing meta description`);
  }

  const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
  if (h1Count !== 1) fail(`${label}: expected one h1, found ${h1Count}`);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) fail(`${label}: duplicate IDs: ${duplicateIds.join(", ")}`);

  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.includes(match[1])) fail(`${label}: anchor target #${match[1]} is missing`);
  }

  for (const match of html.matchAll(/<(?:a|link|img|script)[^>]+(?:href|src)="\/([^"?#]+)[^>]*>/g)) {
    const requested = match[1];
    if (!requested) continue;
    const candidates = [
      join(root, requested),
      join(root, `${requested}.html`),
      join(root, requested, "index.html")
    ];
    if (!candidates.some(existsSync)) fail(`${label}: local path /${requested} does not resolve`);
  }

  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener[^"]*"/.test(match[0])) {
      fail(`${label}: target=_blank link is missing rel=noopener`);
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="[^"]*"/.test(match[0])) fail(`${label}: image is missing alt text`);
    if (!/\bwidth="\d+"/.test(match[0]) || !/\bheight="\d+"/.test(match[0])) {
      fail(`${label}: image is missing intrinsic dimensions`);
    }
  }

  if (/\sonclick=|javascript:/i.test(html)) fail(`${label}: contains unsafe inline behavior`);
  const executableScripts = [...html.matchAll(/<script\b(?![^>]*type="application\/ld\+json")[^>]*>/gi)];
  if (page === "index.html") {
    if (executableScripts.length !== 1) {
      fail(`${label}: expected one local enhancement script, found ${executableScripts.length}`);
    } else if (!/src="\/assets\/maintenance\.v1\.js"/.test(executableScripts[0][0]) || !/\bdefer\b/.test(executableScripts[0][0])) {
      fail(`${label}: maintenance enhancement script must be local and deferred`);
    }
  } else if (executableScripts.length) {
    fail(`${label}: contains unexpected executable client JavaScript`);
  }
  const structuredData = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, payload] of structuredData) {
    try {
      JSON.parse(payload);
    } catch (error) {
      fail(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
  if (/\bhttp:\/\//i.test(html)) fail(`${label}: contains an insecure HTTP URL`);
}

const expectedFiles = [
  "assets/styles.v1.css",
  "assets/speedzone-logo-v1.png",
  "assets/maintenance.v1.js",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "vercel.json"
];

for (const file of expectedFiles) {
  if (!existsSync(join(root, file))) fail(`${file}: required file is missing`);
}

const budgets = {
  "index.html": 30000,
  "road-trip.html": 26000,
  "assets/styles.v1.css": 30000,
  "assets/speedzone-logo-v1.png": 30000,
  "assets/maintenance.v1.js": 5000
};

for (const [file, limit] of Object.entries(budgets)) {
  const path = join(root, file);
  if (existsSync(path) && statSync(path).size > limit) {
    fail(`${file}: ${statSync(path).size} bytes exceeds ${limit}-byte budget`);
  }
}

for (const jsonFile of ["manifest.webmanifest", "vercel.json", "package.json"]) {
  try {
    JSON.parse(readFileSync(join(root, jsonFile), "utf8"));
  } catch (error) {
    fail(`${jsonFile}: invalid JSON (${error.message})`);
  }
}

const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const csp = config.headers?.[0]?.headers?.find((header) => header.key === "Content-Security-Policy")?.value || "";
if (!csp.includes("script-src 'self' 'sha256-")) fail("vercel.json: CSP must allow the local enhancement and hashed JSON-LD payload");
if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) fail("vercel.json: CSP weakens script protections");
if (!csp.includes("frame-ancestors 'none'")) fail("vercel.json: CSP must prevent framing");

const homeHtml = readFileSync(join(root, "index.html"), "utf8");
const jsonLdPayload = homeHtml.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
if (!jsonLdPayload) {
  fail("index.html: missing AutoDealer JSON-LD");
} else {
  const expectedHash = `sha256-${createHash("sha256").update(jsonLdPayload, "utf8").digest("base64")}`;
  if (!csp.includes(`'${expectedHash}'`)) fail("vercel.json: JSON-LD CSP hash is stale");
}

const maintenanceGroups = [...homeHtml.matchAll(/data-tip-groups="([^"]+)"/g)].map((match) => match[1].split(" "));
const maintenanceFilters = [...homeHtml.matchAll(/data-tip-filter="([^"]+)"/g)].map((match) => match[1]);
const payoffCount = (homeHtml.match(/class="tip-payoff"/g) || []).length;
if (maintenanceGroups.length < 12) fail("index.html: car-care section must include at least 12 tips");
if (payoffCount !== maintenanceGroups.length) fail("index.html: every car-care tip needs an investment payoff explanation");
for (const filter of maintenanceFilters.filter((value) => value !== "all")) {
  if (!maintenanceGroups.some((groups) => groups.includes(filter))) {
    fail(`index.html: car-care filter ${filter} has no matching tips`);
  }
}
if (!/data-tip-toolbar\s+hidden/.test(homeHtml)) fail("index.html: car-care filters must progressively enhance from a hidden toolbar");

const roadTripHtml = readFileSync(join(root, "road-trip.html"), "utf8");
const tripCards = (roadTripHtml.match(/class="trip-card"/g) || []).length;
const officialTripLinks = (roadTripHtml.match(/class="trip-link"/g) || []).length;
if (tripCards < 12) fail("road-trip.html: include at least 12 affordable family destinations");
if (officialTripLinks !== tripCards) fail("road-trip.html: every destination needs an official planning link");
if (!/id="central-mass"/.test(roadTripHtml) || !/id="boston-area"/.test(roadTripHtml)) {
  fail("road-trip.html: both Central Massachusetts and Boston sections are required");
}

const cssPath = join(root, "assets/styles.v1.css");
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, "utf8");
  if (!css.includes("prefers-reduced-motion")) fail("styles: missing reduced-motion support");
  if (!css.includes("env(safe-area-inset-bottom)")) fail("styles: mobile dock ignores safe-area inset");
  if (!css.includes(":focus")) fail("styles: missing visible focus treatment");
}

if (failures.length) {
  console.error(`Site validation failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const criticalFiles = ["index.html", "assets/styles.v1.css", "assets/speedzone-logo-v1.png", "assets/maintenance.v1.js"];
const totalBytes = criticalFiles.reduce((sum, file) => sum + statSync(join(root, file)).size, 0);

console.log(`Validated ${pages.length} pages with one small, deferred enhancement script.`);
console.log(`Critical homepage files: ${totalBytes.toLocaleString()} bytes uncompressed.`);
console.log("All local links, anchor targets, metadata, budgets, and Vercel configuration checks passed.");
