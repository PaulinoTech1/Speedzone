import { describe, expect, it, vi } from "vitest";

const timingSafeEqualMock = vi.hoisted(() =>
  vi.fn((left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(Buffer.from(right))),
);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: timingSafeEqualMock };
});

import { constantTimeTextEqual, sha256 } from "@/lib/server/crypto";

describe("bootstrap-token digest comparison", () => {
  it("compares fixed-size digests through timingSafeEqual for matching and nonmatching tokens", () => {
    const configuredHash = sha256("ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE");

    expect(
      constantTimeTextEqual(
        sha256("ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE"),
        configuredHash,
      ),
    ).toBe(true);
    expect(
      constantTimeTextEqual(
        sha256("IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI"),
        configuredHash,
      ),
    ).toBe(false);

    expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
    for (const [left, right] of timingSafeEqualMock.mock.calls) {
      expect(left).toHaveLength(32);
      expect(right).toHaveLength(32);
    }
  });
});
