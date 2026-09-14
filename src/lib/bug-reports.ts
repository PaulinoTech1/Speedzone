import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getRedis } from "@/lib/redis";

export type BugReport = { id: string; createdAt: string; category: "functional" | "security" | "accessibility"; title: string; details: string; page: string; contact: string; reference: string };
export const bugReportMaxBytes = 8192;
export const bugReportAdmissionScript = `
local limits = {20, 50, 2, 5}
local windows = {3600, 86400, 3600, 86400}
local retry = 0
for i = 1, 4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i] then
    retry = math.max(retry, redis.call('TTL', KEYS[i]), 1)
  end
end
if retry > 0 then return retry end
for i = 1, 4 do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('EXPIRE', KEYS[i], windows[i]) end
end
return 0
`;
function encryptionKey() {
  const value = process.env.BUG_REPORT_ENCRYPTION_KEY || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Report encryption unavailable");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("Report encryption unavailable");
  return key;
}
export async function admitBugReport(request: Request) {
  const redis = getRedis();
  const secret = process.env.BUG_REPORT_RATE_LIMIT_SECRET;
  if (!redis || !secret || secret.length < 32) throw new Error("Report admission unavailable");
  encryptionKey();
  // Vercel supplies x-forwarded-for. Outside Vercel every caller shares the strict local bucket.
  const forwarded = process.env.VERCEL ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : "local";
  const ip = forwarded && isIP(forwarded) ? forwarded.toLowerCase() : "shared-unknown";
  const digest = createHmac("sha256", secret).update(ip).digest("hex");
  return Number(await redis.eval(bugReportAdmissionScript, ["speedzone:bug-limit:global-hour", "speedzone:bug-limit:global-day", `speedzone:bug-limit:client-hour:${digest}`, `speedzone:bug-limit:client-day:${digest}`], []));
}
export function validReportOrigin(request: Request) {
  const configured = process.env.BUG_REPORT_ORIGIN;
  const url = new URL(request.url);
  const expected = configured || (!process.env.VERCEL && ["localhost", "127.0.0.1"].includes(url.hostname) ? url.origin : "");
  return Boolean(expected && request.headers.get("origin") === expected && !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") || ""));
}
export async function readReportBody(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > bugReportMaxBytes)) throw new RangeError("Body too large");
  if (!request.body) throw new SyntaxError("Body required");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("Body timeout")); }, 5000); });
  try {
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > bugReportMaxBytes) { void reader.cancel().catch(() => {}); throw new RangeError("Body too large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export function validateBugReport(value: unknown): Omit<BugReport, "id" | "createdAt"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ["category", "title", "details", "page", "contact", "reference"];
  if (Object.keys(input).some(key => !fields.includes(key)) || fields.some(key => typeof input[key] !== "string")) return null;
  const { category, title, details, page, contact, reference } = input as Record<typeof fields[number], string>;
  if (!category || !["functional", "security", "accessibility"].includes(category)) return null;
  if (!title || title.trim().length < 5 || title.length > 120 || !details || details.trim().length < 20 || details.length > 4000) return null;
  if (page === undefined || page.length > 160 || (page && !/^\/[a-zA-Z0-9/_-]*$/.test(page))) return null;
  if (contact === undefined || contact.length > 254 || (contact && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact))) return null;
  if (reference === undefined || (reference && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference))) return null;
  if ([title, details, page, contact, reference].some(text => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))) return null;
  return { category: category as BugReport["category"], title: title.trim(), details: details.trim(), page, contact: contact.trim(), reference };
}
export async function storeBugReport(input: Omit<BugReport, "id" | "createdAt">) {
  const redis = getRedis(); if (!redis) throw new Error("Reports unavailable");
  const report: BugReport = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(report), "utf8"), cipher.final()]);
  const encrypted = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), content.toString("base64url")].join(".");
  await redis.eval(`redis.call('SET', KEYS[1], ARGV[1], 'EX', 2592000); redis.call('LPUSH', KEYS[2], KEYS[1]); redis.call('LTRIM', KEYS[2], 0, 199); redis.call('EXPIRE', KEYS[2], 2592000); return 1`, [`speedzone:bug-report:${report.id}`, "speedzone:bug-report:index"], [encrypted]);
  return report.id;
}
export async function readBugReports() {
  const redis = getRedis(); if (!redis) throw new Error("Reports unavailable");
  const keys = await redis.lrange<string>("speedzone:bug-report:index", 0, 99);
  if (!keys.length) return [];
  const values = await redis.mget<(string | null)[]>(...keys);
  return values.flatMap<BugReport | { id: string; unreadable: true }>((value, index) => {
    if (!value) return [];
    try {
      const [version, iv, tag, ciphertext] = value.split(".");
      if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return [JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as BugReport];
    } catch { return [{ id: keys[index]?.split(":").pop() || "unreadable", unreadable: true }]; }
  });
}
