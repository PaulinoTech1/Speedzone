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
