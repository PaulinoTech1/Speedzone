import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => database.query) }));

import { checkRateLimit, resetRateLimitsForTests } from "@/lib/server/rate-limit";

beforeEach(() => {
  resetRateLimitsForTests();
  database.query.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __speedzoneAuthDatabase?: unknown }).__speedzoneAuthDatabase;
});

function useDatabase() {
  vi.stubEnv("AUTH_DATABASE_URL", "postgresql://fixture:fixture@fixture.neon.tech/SEcure_Auth?sslmode=require");
  vi.stubEnv("NODE_ENV", "production");
}

describe("shared rate-limit storage boundary", () => {
  it("uses the database decision even on a fresh worker", async () => {
    useDatabase();
    database.query.mockResolvedValue([{ attempts: 6, retry_after: 23 }]);
    expect(await checkRateLimit("password", "client:192.0.2.10")).toEqual({ allowed: false, retryAfter: 23 });
    expect(database.query).toHaveBeenCalledTimes(1);
    const [, key] = database.query.mock.calls[0]!;
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(database.query.mock.calls)).not.toContain("192.0.2.10");
  });

  it("does not cache a worker-local allowance across requests", async () => {
    useDatabase();
    database.query.mockResolvedValueOnce([{ attempts: 1, retry_after: 900 }]);
    database.query.mockResolvedValueOnce([{ attempts: 6, retry_after: 890 }]);
    expect(await checkRateLimit("password", "client:shared")).toEqual({ allowed: true, remaining: 4 });
    expect(await checkRateLimit("password", "client:shared")).toEqual({ allowed: false, retryAfter: 890 });
    expect(database.query.mock.calls[0]![1]).toBe(database.query.mock.calls[1]![1]);
  });

  it.each([{ rows: [] }, { rows: [{ attempts: 0, retry_after: 900 }] }, { rows: [{ attempts: 1, retry_after: -1 }] }])(
    "fails closed on a malformed database decision $rows", async ({ rows }) => {
      useDatabase();
      database.query.mockResolvedValue(rows);
      await expect(checkRateLimit("password", "invalid")).rejects.toThrow("Invalid rate-limit storage response");
    },
  );

  it("fails closed when production storage is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(checkRateLimit("password", "missing")).rejects.toThrow("Shared rate-limit storage is not configured");
  });

  it.each(["42P01", "42501", "28P01"])("fails closed on database error %s", async (code) => {
    useDatabase();
    database.query.mockRejectedValue(Object.assign(new Error("provider secret"), { code }));
    await expect(checkRateLimit("password", "failed")).rejects.toThrow(/Authentication/);
    await expect(checkRateLimit("password", "failed")).rejects.not.toThrow("provider secret");
  });
});

describe("bounded local development counters", () => {
  it("expires the original window even when rejected requests continue", async () => {
    for (let n = 0; n < 5; n++) await checkRateLimit("password", "window", 1_000);
    expect(await checkRateLimit("password", "window", 900_000)).toEqual({ allowed: false, retryAfter: 1 });
    expect(await checkRateLimit("password", "window", 901_000)).toEqual({ allowed: true, remaining: 4 });
  });

  it("caps retained keys without evicting live limits, then reclaims expired keys", async () => {
    for (let n = 0; n < 5; n++) await checkRateLimit("inventory", "protected", 1_000);
    for (let n = 1; n < 10_000; n++) await checkRateLimit("inventory", `key-${n}`, 1_000);
    expect((await checkRateLimit("inventory", "new-key", 1_001)).allowed).toBe(false);
    expect(await checkRateLimit("inventory", "protected", 1_001)).toEqual({ allowed: true, remaining: 114 });
    expect((await checkRateLimit("inventory", "new-key", 61_000)).allowed).toBe(true);
  });
});
