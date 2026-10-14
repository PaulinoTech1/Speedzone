import { isIP } from "node:net";
import type { TestDriveFields } from "@/lib/test-drive-validation";

// Boundary checks for the public test-drive endpoint. Everything here runs
// before any storage, rate-limit or email work.

export const TEST_DRIVE_MAX_BYTES = 8 * 1024;
export const TEST_DRIVE_CONTENT_TYPE = "application/x-www-form-urlencoded";
const requiredFields = ["requestId", "name", "email", "phone", "vehicle", "date", "time"] as const;
const allowedFields = new Set<string>([...requiredFields, "notes"]);
const productionOrigins = ["https://www.speedzonems.com", "https://speedzonems.com", "https://speedzone-five.vercel.app"];

export class TestDriveRequestError extends Error {
  constructor(public status: 400 | 403 | 408 | 413 | 415, message: string) { super(message); }
}

/** Exact Origin allowlist plus Fetch Metadata, matching the bug-report route. */
export function allowedTestDriveOrigins(request: Request) {
  const origins = [...productionOrigins];
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) if (host && process.env.VERCEL_ENV !== "production") origins.push(`https://${host}`);
  const local = localOrigin(request);
  if (local) origins.push(local);
  return origins;
}
// Off Vercel only (dev/e2e): `next start` reports its own listen port in
// request.url, so the browser-visible origin comes from the Host header.
function localOrigin(request: Request) {
  if (process.env.VERCEL) return null;
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  return /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host) ? `${url.protocol}//${host}` : null;
}
export function validTestDriveOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return Boolean(origin && allowedTestDriveOrigins(request).includes(origin) && origin === (localOrigin(request) ?? new URL(request.url).origin) && (!site || site === "same-origin"));
}

/** Client IP from Vercel's edge-set header; never a client-supplied X-Forwarded-For chain. */
export function trustedClientIp(headers: Headers) {
  if (!process.env.VERCEL) return "local";
  const value = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  return isIP(value) ? value.toLowerCase() : "unknown";
}

async function readBounded(request: Request, limit: number) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new TestDriveRequestError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new TestDriveRequestError(400, "Invalid form");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new TestDriveRequestError(408, "Request timed out.")); }, 5000); });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new TestDriveRequestError(413, "Request is too large."); }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof TestDriveRequestError) throw error;
    throw new TestDriveRequestError(400, "Invalid form");
  } finally { clearTimeout(timer); }
}

/** Content-type, streaming size cap, then a strict schema: no unknown or duplicate fields. */
export async function readTestDriveForm(request: Request): Promise<{ requestId: string; fields: TestDriveFields }> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== TEST_DRIVE_CONTENT_TYPE) throw new TestDriveRequestError(415, "Form request required.");
  const params = new URLSearchParams(await readBounded(request, TEST_DRIVE_MAX_BYTES));
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowedFields.has(key)) throw new TestDriveRequestError(400, "Unexpected form field.");
    if (seen.has(key)) throw new TestDriveRequestError(400, "Duplicate form field.");
    seen.add(key);
  }
  const value = (key: string) => (params.get(key) ?? "").trim();
  return {
    requestId: value("requestId"),
    fields: { name: value("name"), email: value("email").toLowerCase(), phone: value("phone"), vehicle: value("vehicle"), date: value("date"), time: value("time"), notes: value("notes") },
  };
}
