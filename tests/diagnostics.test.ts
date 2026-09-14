import { beforeEach, afterEach, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));
import { withDiagnostics } from "@/lib/diagnostics";
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it("stores verbose codes without exposing details in public responses", async () => {
  const response = await withDiagnostics("CUSTOMER_REQUEST_ACCEPT", async () => { throw new Error("password=secret customer@example.com stacktrace"); });
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body.reference).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(body)).not.toMatch(/SPEEDZONE_|password|stacktrace|customer@example/);
  const stored = JSON.parse(redis.eval.mock.calls[0]?.[2][0]);
  expect(stored.code).toBe("SPEEDZONE_CUSTOMER_REQUEST_ACCEPT_UNEXPECTED_OPERATION_FAILURE");
  expect(stored.remediation).toBeTruthy();
  expect(JSON.stringify(stored)).not.toMatch(/secret|customer@example|stacktrace/);
});
it("hides explicit configuration errors as well as thrown exceptions", async () => {
  const response = await withDiagnostics("ADMIN_PASSWORD_BOOTSTRAP", async () => Response.json({ error: "Redis secret missing", code: "PRIVATE_CODE" }, { status: 503 }));
  expect(await response.text()).not.toMatch(/Redis|PRIVATE_CODE/);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("preserves success identity/cookies and failure does not depend on diagnostic storage", async () => {
  const success = Response.json({ ok: true }, { headers: { "set-cookie": "session=synthetic; HttpOnly" } });
  expect(await withDiagnostics("ADMIN_PASSKEY_OPERATION", async () => success)).toBe(success);
  expect(redis.eval).not.toHaveBeenCalled();
  redis.eval.mockRejectedValue(new Error("offline"));
  expect((await withDiagnostics("INVENTORY_CATALOG_READ", async () => new Response("", { status: 500 }))).status).toBe(500);
});
