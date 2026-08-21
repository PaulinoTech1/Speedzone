import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { consumeOnce } from "@/lib/server/storage/consume-once";

describe("one-time security markers", () => {
  it.each(["challenge", "recovery"] as const)("rejects replay for %s markers", async (namespace) => {
    const digest = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
    const marker = resolve(`.data/security-consume/${namespace}/${digest}.json`);
    try {
      expect(await consumeOnce(namespace, digest, Date.now() + 60_000)).toBe(true);
      expect(await consumeOnce(namespace, digest, Date.now() + 60_000)).toBe(false);
    } finally {
      await rm(marker, { force: true });
    }
  });
});
