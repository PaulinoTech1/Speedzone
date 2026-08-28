import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const markers = vi.hoisted(() => ({ rows: new Set<string>() }));

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    if (!text.startsWith("INSERT INTO auth_consume_markers")) {
      return Promise.reject(new Error(`Unexpected SQL: ${text}`));
    }
    // The composite primary key is the single-use guarantee, so a repeated
    // digest inserts nothing and returns no rows.
    const key = `${String(values[0])}:${String(values[1])}`;
    if (markers.rows.has(key)) return Promise.resolve([]);
    markers.rows.add(key);
    return Promise.resolve([{ consumed: 1 }]);
  }),
}));

import { consumeOnce } from "@/lib/server/storage/consume-once";

const connectionString = "postgresql://user:secret@ep-shy-sunset.aws.neon.tech/SEcure_Auth?sslmode=require";

function digest(): string {
  return crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
}

afterEach(() => {
  markers.rows.clear();
  vi.unstubAllEnvs();
  delete (globalThis as { __speedzoneAuthDatabase?: unknown }).__speedzoneAuthDatabase;
});

describe("one-time security markers", () => {
  it.each(["challenge", "recovery"] as const)(
    "rejects replay for %s markers on the local record",
    async (namespace) => {
      const value = digest();
      const marker = resolve(`.data/security-consume/${namespace}/${value}.json`);
      try {
        expect(await consumeOnce(namespace, value, Date.now() + 60_000)).toBe(true);
        expect(await consumeOnce(namespace, value, Date.now() + 60_000)).toBe(false);
      } finally {
        await rm(marker, { force: true });
      }
    },
  );

  it.each(["challenge", "stepup"] as const)(
    "rejects replay for %s markers in SEcure_Auth",
    async (namespace) => {
      vi.stubEnv("AUTH_DATABASE_URL", connectionString);
      const value = digest();

      expect(await consumeOnce(namespace, value, Date.now() + 60_000)).toBe(true);
      expect(await consumeOnce(namespace, value, Date.now() + 60_000)).toBe(false);
      expect(await consumeOnce(namespace, digest(), Date.now() + 60_000)).toBe(true);
    },
  );

  it("fails closed in production when no authentication database is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(consumeOnce("challenge", digest(), Date.now() + 60_000)).rejects.toThrow(
      /SEcure_Auth/,
    );
  });
});
