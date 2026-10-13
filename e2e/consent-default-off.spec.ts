import { expect, test } from "@playwright/test";

test("with the Pixel flag off, no banner renders and no Meta requests are made", async ({ page }) => {
  const thirdParty: string[] = [];
  page.on("request", request => { if (/facebook\.(com|net)/.test(new URL(request.url()).hostname)) thirdParty.push(request.url()); });
  for (const path of ["/", "/inventory", "/inventory/e2e-honda-civic", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator(".consent-banner")).toHaveCount(0);
    expect(await page.evaluate(() => "fbq" in window)).toBe(false);
  }
  const csp = (await page.goto("/"))!.headers()["content-security-policy"];
  expect(csp).not.toContain("facebook");
  expect(thirdParty).toEqual([]);
  expect(await page.content()).not.toMatch(/fbevents|META_PIXEL/);
});
