import { expect, it } from "vitest";
import { readBoundedJson, validMutationOrigin } from "../security-console/shared/mutation-request";
const origin = "https://admin.speedzone.example";
it("rejects a sibling origin even when both are allowed console origins", () => {
  const request = new Request(origin, { headers: { origin: "https://www.speedzone.example", "sec-fetch-site": "same-site" } });
  expect(validMutationOrigin(request, [origin, "https://www.speedzone.example"])).toBe(false);
  expect(validMutationOrigin(new Request(origin, { headers: { origin, "sec-fetch-site": "same-origin" } }), [origin])).toBe(true);
});
it("rejects simple text/plain JSON before parsing", async () => {
  await expect(readBoundedJson(new Request(origin, { method: "POST", headers: { "content-type": "text/plain" }, body: '{"confirm":true}' }))).rejects.toMatchObject({ status: 415 });
});
it("bounds a body without a declared content length", async () => {
  await expect(readBoundedJson(new Request(origin, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(2048) }) }), 1024)).rejects.toMatchObject({ status: 413 });
});
