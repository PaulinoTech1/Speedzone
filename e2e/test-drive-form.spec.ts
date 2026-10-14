import { expect, test, type Page } from "@playwright/test";

function nextWeekday() {
  const date = new Date(); date.setDate(date.getDate() + 3);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function fill(page: Page) {
  await page.goto("/test-drive");
  await page.getByLabel("Full name").fill("E2E Customer");
  await page.getByLabel(/Email address/).fill("e2e@example.com");
  await page.getByLabel(/Phone number/).fill("5085550100");
  await page.getByLabel("Vehicle of interest").fill("2022 Honda Civic");
  await page.getByLabel("Preferred date").fill(nextWeekday());
  await page.getByLabel("Preferred time").selectOption("10:00 AM");
  await page.getByLabel(/Notes/).fill("Synthetic e2e request");
}

test("the real form passes the API boundary checks (origin, content type, size, strict schema)", async ({ page }) => {
  await fill(page);
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/test-drive") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Request a test drive" }).click();
  const response = await responsePromise;
  const request = response.request();
  expect(request.headers()["content-type"]).toBe("application/x-www-form-urlencoded");
  expect([...new URLSearchParams(request.postData() ?? "").keys()].sort()).toEqual(["date", "email", "name", "notes", "phone", "requestId", "time", "vehicle"]);
  // The e2e server has no private storage configured. Reaching that check (503) proves the request
  // was accepted by every boundary check that runs before it; a boundary rejection would be 4xx.
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("the form shows confirmation when the API accepts the request", async ({ page }) => {
  await page.route("**/api/test-drive", route => route.fulfill({ status: 201, json: { ok: true, id: "11111111-1111-4111-8111-111111111111" } }));
  await fill(page);
  await page.getByRole("button", { name: "Request a test drive" }).click();
  await expect(page.getByText("Request received")).toBeVisible();
});
