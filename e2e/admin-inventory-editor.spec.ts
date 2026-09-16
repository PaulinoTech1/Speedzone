import { expect, test } from "@playwright/test";
for (const width of [390, 768, 1280]) {
  test(`inventory editor fits and saves VIN at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let vehicle = { id: "test-car", year: 2022, make: "Honda", model: "Civic", price: 18000, mileage: 32000, condition: "Used", status: "available", description: "Test listing", photos: [], createdAt: "2026-09-09T00:00:00.000Z", vin: "" };
    await page.route("**/api/admin/session", route => route.fulfill({ json: { state: "authenticated" } }));
    await page.route("**/api/admin/passkey**", route => route.fulfill({ json: { passkeys: [] } }));
    await page.route("**/api/admin/test-drives", route => route.fulfill({ json: [] }));
    await page.route("**/api/inventory", async route => {
      if (route.request().method() === "PATCH") {
        vehicle = { ...vehicle, ...route.request().postDataJSON() };
        await route.fulfill({ json: vehicle, headers: { etag: "updated" } });
      } else await route.fulfill({ json: [vehicle], headers: { etag: "initial" } });
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Edit listing", exact: true }).click();
    const editor = page.locator(".admin-edit-form");
    await expect(editor).toBeVisible();
    const fits = await editor.evaluate(form => {
      const rect = form.getBoundingClientRect();
      const inputs = Array.from(form.querySelectorAll("input, select, textarea"));
      return inputs.every((input, i) => {
        const a = input.getBoundingClientRect();
        return a.width > 80 && a.left >= rect.left - 1 && a.right <= rect.right + 1 && inputs.slice(i + 1).every(other => {
          const b = other.getBoundingClientRect();
          return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        });
      });
    });
    expect(fits).toBe(true);
    await editor.locator('input[name="vin"]').fill("1hgcm82633a004352");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("button", { name: "Reload inventory" }).click();
    await page.getByRole("button", { name: "Edit listing", exact: true }).click();
    await expect(editor.locator('input[name="vin"]')).toHaveValue("1HGCM82633A004352");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await editor.screenshot({ path: `test-results/inventory-editor-${width}.png` });
  });
}
