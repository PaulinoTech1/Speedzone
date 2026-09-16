import { expect, test } from "@playwright/test";

test("password login shows customer requests, preserves the diagnostics gate, and clears requests on logout", async ({ page }) => {
  let state = "signed-out";
  await page.route("**/api/admin/session", route => route.fulfill({ json: { state } }));
  await page.route("**/api/admin/login", route => {
    state = route.request().method() === "DELETE" ? "signed-out" : "setup";
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/admin/passkey", route => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await page.route("**/api/inventory", route => route.fulfill({ json: [], headers: { etag: "fixture" } }));
  await page.route("**/api/admin/test-drives", route => route.fulfill({ json: [{
    id: "synthetic", pathname: "test-drive/requests/synthetic.enc", name: "Inbox test customer",
    email: "customer@example.invalid", phone: "2025550100", vehicle: "Test vehicle", date: "2099-01-05", time: "10:00 AM",
  }] }));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Test-drive requests" })).toHaveCount(0);
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toHaveCount(0);
});
