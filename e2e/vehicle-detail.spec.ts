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

test("vehicle page ships Open Graph tags and Car JSON-LD from the CDN document cache without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto("/inventory/e2e-honda-civic");
  const headers = response!.headers();
  expect(headers["cache-control"]).toMatch(/^public, .*s-maxage=300/);
  const csp = headers["content-security-policy"]!;
  expect(csp).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/);
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).toContain("frame-ancestors 'none'");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "2022 Honda Civic EX");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/inventory\/e2e-honda-civic$/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /\$18,000 · 32,000 miles · Sedan/);
  const script = page.locator('script[type="application/ld+json"]');
  await expect(script).toHaveCount(1);
  // JSON-LD is a data block, not script: CSP does not apply and cached HTML carries no nonce.
  expect(await script.getAttribute("nonce")).toBeNull();
  const data = JSON.parse((await script.textContent()) || "{}");
  expect(data).toMatchObject({ "@type": "Car", name: "2022 Honda Civic EX", offers: { price: 18000, priceCurrency: "USD" } });
  expect(violations).toEqual([]);
});

test("admin and API responses are never publicly cacheable", async ({ request }) => {
  for (const path of ["/api/inventory", "/api/admin/session", "/api/feeds/meta-vehicles"]) {
    const response = await request.get(path);
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl, path).toContain("no-store");
    expect(cacheControl, path).not.toMatch(/public|s-maxage/);
  }
  const admin = await request.get("http://localhost:4184/");
  expect(admin.headers()["cache-control"]).toContain("no-store");
  expect(admin.headers()["content-security-policy"]).toMatch(/'nonce-[0-9a-f]{32}' 'strict-dynamic'/);
});
