import { expect, test } from "@playwright/test";

test("inventory cards link to a stable vehicle detail page", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByRole("link", { name: "View details" }).first().click();
  await expect(page).toHaveURL(/\/inventory\/e2e-honda-civic$/);
  const detail = page.getByTestId("vehicle-detail");
  await expect(detail.getByRole("heading", { level: 1 })).toHaveText("2022 Honda Civic EX");
  await expect(detail).toContainText("Sedan");
  await expect(detail).toContainText("Silver");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/inventory\/e2e-honda-civic$/);
});

test("unknown or malformed vehicle ids return not found", async ({ page }) => {
  for (const path of ["/inventory/does-not-exist", "/inventory/%3Cscript%3E"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
