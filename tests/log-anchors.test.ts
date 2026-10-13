import { describe, expect, it } from "vitest";
import { createSecurityEvent } from "@/lib/security-events";
// @ts-expect-error plain .mjs module without types
import { canonical, sha256 } from "../scripts/log-anchors/lib.mjs";

describe("log anchors", () => {
  it("hashes events exactly like the site", () => {
    const event = createSecurityEvent({ event: "admin.login" as never, outcome: "failure" as never, actor: "admin", requestId: "req_parity1", route: "/x", method: "POST", reason: "ünïcode \u2028 \"q\"", metadata: { a: 1.5, b: null, z: true, k: "s" } });
    expect(sha256(canonical(event))).toBe(event.hash);
  });
  it("passes the synthetic fixture suite", async () => {
    // @ts-expect-error plain .mjs module without types
    await expect(import("../scripts/log-anchors/test.mjs")).resolves.toBeDefined();
  });
});

describe("log anchors APL fallback", () => {
  it("falls back to a time-sorted APL query and masks tokens in errors", async () => {
    // @ts-expect-error plain .mjs module without types
    const { fetchWindow } = await import("../scripts/log-anchors/lib.mjs");
    const calls: Array<{ url: string; body: { apl?: string } }> = [];
    const okFetch = async (u: URL | string, init: { body: string }) => {
      calls.push({ url: String(u), body: JSON.parse(init.body) });
      if (calls.length === 1) return { ok: false, status: 403, text: async () => JSON.stringify({ message: "forbidden xaat-abc123-def" }) };
      return { ok: true, json: async () => ({ matches: [{ _time: "2026-10-13T10:00:00Z", data: {} }] }) };
    };
    const rows = await fetchWindow(0, 3600_000, { url: "https://api.axiom.co/v1/datasets/sec'logs/query", token: "t", fetchImpl: okFetch });
    expect(rows).toHaveLength(1);
    expect(calls[1]?.url).toContain("/v1/datasets/_apl");
    expect(calls[1]?.body.apl).toMatch(/^\['seclogs'\] \| sort by _time asc \| limit \d+$/);

    let n = 0;
    const badFetch = async () => ({ ok: false, status: ++n === 1 ? 401 : 403, text: async () => JSON.stringify({ message: "bad token xapt-SECRET-123 and xaat-OTHER-9" }) });
    const err = await fetchWindow(0, 3600_000, { url: "https://api.axiom.co/v1/datasets/seclogs/query", token: "t", fetchImpl: badFetch }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("HTTP 401");
    expect(err.message).toContain("HTTP 403");
    expect(err.message).toContain("[redacted]");
    expect(err.message).not.toMatch(/SECRET|OTHER/);
  });
});
