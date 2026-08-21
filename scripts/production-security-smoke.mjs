import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const buildId = path.join(projectRoot, ".next", "BUILD_ID");
const hostname = "127.0.0.1";
const port = parsePort(process.env.PRODUCTION_SMOKE_PORT ?? "4193");
const baseUrl = `http://${hostname}:${port}`;
const expectedHsts = "max-age=63072000; includeSubDomains; preload";
const expectedAdminCache = "no-store, max-age=0";
const expectedRobots = "noindex, nofollow, noarchive";

const requestCases = [
  { name: "home", path: "/", status: 200 },
  { name: "road trip", path: "/road-trip", status: 200 },
  { name: "privacy", path: "/privacy", status: 200 },
  { name: "terms", path: "/terms", status: 200 },
  { name: "admin login", path: "/admin/login", status: 200, admin: true },
  {
    name: "full HTML with Purpose: prefetch",
    path: "/",
    status: 200,
    headers: { Purpose: "prefetch" },
  },
  {
    name: "full HTML with Next-Router-Prefetch",
    path: "/road-trip",
    status: 200,
    headers: { "Next-Router-Prefetch": "1" },
  },
  {
    name: "admin full HTML with both prefetch headers",
    path: "/admin/login",
    status: 200,
    admin: true,
    headers: { Purpose: "prefetch", "Next-Router-Prefetch": "1" },
  },
  { name: "not found", path: "/production-security-smoke-not-found", status: 404 },
];

await access(nextCli);
await access(buildId).catch(() => {
  throw new Error("No production build found. Run `npm run build` before this smoke check.");
});

const serverOutput = [];
const server = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", hostname, "--port", String(port)],
  {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

captureOutput(server.stdout, serverOutput);
captureOutput(server.stderr, serverOutput);

let testFailure;

try {
  await waitUntilReady(server);

  const nonces = new Set();
  let assertionCount = 0;

  for (const testCase of requestCases) {
    const result = await verifyHtmlResponse(testCase);
    nonces.add(result.nonce);
    assertionCount += result.assertionCount;
    console.log(`PASS ${testCase.name}: ${result.scriptCount} script nonce(s) matched CSP`);
  }

  assert.equal(
    nonces.size,
    requestCases.length,
    "Every request must receive a fresh CSP nonce",
  );
  assertionCount += 1;

  console.log(
    `Production security smoke passed: ${requestCases.length} responses, ${assertionCount} assertions, ${nonces.size} unique nonces.`,
  );
} catch (error) {
  testFailure = error;
} finally {
  await stopServer(server);
}

if (testFailure) {
  const logs = serverOutput.join("").trim();
  if (logs) console.error(`\nProduction server output:\n${logs}`);
  throw testFailure;
}

async function verifyHtmlResponse(testCase) {
  const response = await fetch(`${baseUrl}${testCase.path}`, {
    headers: { Accept: "text/html", ...testCase.headers },
    redirect: "manual",
  });
  const html = await response.text();
  let assertionCount = 0;

  assert.equal(response.status, testCase.status, `${testCase.name}: unexpected HTTP status`);
  assertionCount += 1;
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html(?:;|$)/i,
    `${testCase.name}: response is not full HTML`,
  );
  assertionCount += 1;
  assert.match(html, /<!doctype html>/i, `${testCase.name}: response has no HTML doctype`);
  assertionCount += 1;

  const csp = requiredHeader(response, "content-security-policy", testCase.name);
  const nonceMatches = [
    ...csp.matchAll(/(?:^|;)\s*script-src\s+[^;]*?'nonce-([^']+)'/g),
  ];
  assert.equal(nonceMatches.length, 1, `${testCase.name}: CSP must have exactly one script nonce`);
  assertionCount += 2;
  const nonce = nonceMatches[0][1];
  assert.match(nonce, /^[a-f0-9]{32}$/, `${testCase.name}: malformed CSP nonce`);
  assertionCount += 1;
  assert.match(csp, /(?:^|;)\s*script-src\s+[^;]*?'strict-dynamic'(?:\s|;|$)/, `${testCase.name}: CSP is missing strict-dynamic`);
  assertionCount += 1;
  assert.match(csp, /(?:^|;)\s*upgrade-insecure-requests(?:;|$)/, `${testCase.name}: production CSP is missing upgrade-insecure-requests`);
  assertionCount += 1;
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/, `${testCase.name}: production CSP contains an unsafe fallback`);
  assertionCount += 1;

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scriptTags.length > 0, `${testCase.name}: no emitted script tags were found`);
  assertionCount += 1;
  for (const tag of scriptTags) {
    const scriptNonce = readAttribute(tag, "nonce");
    assert.equal(scriptNonce, nonce, `${testCase.name}: script nonce does not exactly match CSP`);
    assertionCount += 1;
  }

  assert.equal(requiredHeader(response, "strict-transport-security", testCase.name), expectedHsts, `${testCase.name}: HSTS policy changed`);
  assertionCount += 2;
  assert.equal(response.headers.get("x-powered-by"), null, `${testCase.name}: framework disclosure header is present`);
  assertionCount += 1;

  if (testCase.admin) {
    assert.equal(requiredHeader(response, "cache-control", testCase.name), expectedAdminCache, `${testCase.name}: admin response is cacheable`);
    assert.equal(requiredHeader(response, "x-robots-tag", testCase.name), expectedRobots, `${testCase.name}: admin response may be indexed`);
    assert.match(csp, /(?:^|;)\s*script-src\s+[^;]*?'wasm-unsafe-eval'(?:\s|;|$)/, `${testCase.name}: admin CSP does not permit the required WebAssembly runtime`);
    assertionCount += 5;
  } else {
    assert.doesNotMatch(csp, /'wasm-unsafe-eval'/, `${testCase.name}: public CSP unnecessarily permits WebAssembly evaluation`);
    assertionCount += 1;
  }

  return { assertionCount, nonce, scriptCount: scriptTags.length };
}

function requiredHeader(response, name, caseName) {
  const value = response.headers.get(name);
  assert.ok(value, `${caseName}: missing ${name} header`);
  return value;
}

function readAttribute(tag, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parsePort(rawPort) {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("PRODUCTION_SMOKE_PORT must be an integer from 1024 through 65535");
  }
  return parsed;
}

function captureOutput(stream, output) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output.push(chunk);
    if (output.length > 200) output.shift();
  });
}

async function waitUntilReady(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited before becoming ready (code ${child.exitCode})`);
    }

    try {
      const response = await fetch(`${baseUrl}/`, {
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Production server did not become ready at ${baseUrl} within 30 seconds`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  const exitPromise = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const exited = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await exitPromise;
  }
}
