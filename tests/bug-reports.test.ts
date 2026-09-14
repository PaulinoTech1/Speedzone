import { beforeEach, afterEach, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ eval: vi.fn(), lrange: vi.fn(), mget: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));
import { admitBugReport, readBugReports, readReportBody, storeBugReport, validateBugReport, validReportOrigin } from "@/lib/bug-reports";
const report = { category: "security", title: "Synthetic security report", details: "Steps to reproduce a synthetic issue, with no real data.", page: "/inventory", contact: "", reference: "" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("BUG_REPORT_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64url")); vi.stubEnv("BUG_REPORT_RATE_LIMIT_SECRET", "synthetic-secret-for-report-limits-12345"); vi.stubEnv("BUG_REPORT_ORIGIN", "https://www.speedzonems.com"); });
afterEach(() => vi.unstubAllEnvs());
it("requires the configured origin and rejects sibling/cross-site origins", () => {
  expect(validReportOrigin(new Request("https://www.speedzonems.com/api/bug-reports", { headers: { origin: "https://www.speedzonems.com" } }))).toBe(true);
  for (const origin of ["https://evil.example", "null", "https://preview.speedzonems.com", ""]) expect(validReportOrigin(new Request("https://www.speedzonems.com/api/bug-reports", { headers: { origin } }))).toBe(false);
});
it("validates types, limits, unexpected fields and page paths without fetching URLs", () => {
  expect(validateBugReport(report)).not.toBeNull();
  for (const changed of [{ details: "short" }, { title: "x".repeat(121) }, { page: "https://internal.example" }, { page: "/admin?token=secret" }, { contact: {} }, { attachment: "payload" }, { details: "\u0000".repeat(30) }]) expect(validateBugReport({ ...report, ...changed })).toBeNull();
});
it("bounds streamed bytes even without a Content-Length header", async () => {
  await expect(readReportBody(new Request("https://example.test", { method: "POST", body: "x".repeat(8193) }))).rejects.toBeInstanceOf(RangeError);
  expect(await readReportBody(new Request("https://example.test", { method: "POST", body: JSON.stringify(report) }))).toEqual(report);
});
it("uses a single atomic distributed admission and stores only keyed client identifiers", async () => {
  vi.stubEnv("VERCEL", "1"); redis.eval.mockResolvedValue(3600);
  expect(await admitBugReport(new Request("https://example.test", { headers: { "x-forwarded-for": "192.0.2.1" } }))).toBe(3600);
  const [script, keys] = redis.eval.mock.calls[0]!;
  expect(script).toContain("local limits = {20, 50, 2, 5}");
  expect(keys).toHaveLength(4); expect(JSON.stringify(keys)).not.toContain("192.0.2.1");
  redis.eval.mockRejectedValue(new Error("offline"));
  await expect(admitBugReport(new Request("https://example.test"))).rejects.toThrow();
});
it("encrypts reports and enforces record expiry in the atomic storage script", async () => {
  const validated = validateBugReport(report)!;
  const id = await storeBugReport(validated);
  const [script, keys, args] = redis.eval.mock.calls[0]!;
  expect(script).toContain("2592000"); expect(args[0]).not.toContain(report.title);
  redis.lrange.mockResolvedValue([keys[0]]); redis.mget.mockResolvedValue([args[0]]);
  expect(await readBugReports()).toEqual([expect.objectContaining({ ...validated, id })]);
  redis.mget.mockResolvedValue(["v1.bad.bad.bad"]);
  expect(await readBugReports()).toEqual([{ id, unreadable: true }]);
});
