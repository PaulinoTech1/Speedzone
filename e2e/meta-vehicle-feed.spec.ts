import { expect, test } from "@playwright/test";

test("catalog feed stays disabled without a configured token", async ({ request }) => {
  const response = await request.get("/api/feeds/meta-vehicles?token=anything");
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toContain("no-store");
});
