import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readEvents, SecurityProviderError, securityProviderErrorMessage } from "../security-console/lib/security-store";
const transport = vi.fn();
beforeEach(() => {
  vi.stubEnv("SECURITY_LOG_PROVIDER", "axiom");
  vi.stubEnv("SECURITY_LOG_QUERY_URL", "https://api.axiom.co/v1/datasets/test/query");
  vi.stubEnv("SECURITY_LOG_QUERY_TOKEN", "private-test-token");
  vi.stubGlobal("fetch", transport); transport.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([400, 401, 403, 404, 422, 429, 500])("reports HTTP %s without exposing provider response contents", async status => {
  transport.mockResolvedValue(new Response("private-test-token", { status }));
  const error = await readEvents().catch(error => error);
  expect(error).toBeInstanceOf(SecurityProviderError);
  expect(securityProviderErrorMessage(error)).toContain(`HTTP ${status}`);
  expect(securityProviderErrorMessage(error)).not.toContain("private-test-token");
});
it("distinguishes unreachable services from malformed responses and empty datasets", async () => {
  transport.mockRejectedValueOnce(new Error("private-test-token"));
  expect(securityProviderErrorMessage(await readEvents().catch(error => error))).toContain("could not be reached");
  transport.mockResolvedValueOnce(Response.json({ unexpected: true }));
  expect(securityProviderErrorMessage(await readEvents().catch(error => error))).toContain("unexpected response");
  transport.mockResolvedValueOnce(Response.json({ matches: [] }));
  await expect(readEvents()).resolves.toEqual([]);
});
it("rejects an ingest endpoint before sending the query token", async () => {
  vi.stubEnv("SECURITY_LOG_QUERY_URL", "https://api.axiom.co/v1/datasets/test/ingest");
  expect(securityProviderErrorMessage(await readEvents().catch(error => error))).toContain("dataset query path");
  expect(transport).not.toHaveBeenCalled();
});
it("never exposes unexpected error messages", () => {
  expect(securityProviderErrorMessage(new Error("private-test-token"))).not.toContain("private-test-token");
});
