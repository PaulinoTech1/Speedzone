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

test("vehicle page ships Open Graph tags and nonce'd Car JSON-LD without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/inventory/e2e-honda-civic");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "2022 Honda Civic EX");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/inventory\/e2e-honda-civic$/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /\$18,000 · 32,000 miles · Sedan/);
  const script = page.locator('script[type="application/ld+json"]');
  await expect(script).toHaveCount(1);
  // Browsers blank the nonce attribute once applied; its presence proves it was emitted.
  expect(await script.getAttribute("nonce")).not.toBeNull();
  const data = JSON.parse((await script.textContent()) || "{}");
  expect(data).toMatchObject({ "@type": "Car", name: "2022 Honda Civic EX", offers: { price: 18000, priceCurrency: "USD" } });
  expect(violations).toEqual([]);
});
