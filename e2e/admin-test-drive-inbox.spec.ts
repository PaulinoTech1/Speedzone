import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:4184" });

test("password setup hides customer requests until passkey authentication", async ({ page }) => {
  let state = "signed-out";
  let inboxReads = 0;
  let inventoryReads = 0;
  await page.route("**/api/admin/session", route => route.fulfill({ json: { state } }));
  await page.route("**/api/admin/login", route => {
    state = route.request().method() === "DELETE" ? "signed-out" : "setup";
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/admin/passkey", route => route.fulfill({ json: { passkeys: [] } }));
  await page.route("**/api/inventory", route => {
    inventoryReads++;
    return route.fulfill({ json: { vehicles: [], revision: "fixture" } });
  });
  await page.route("**/api/admin/test-drives", route => {
    inboxReads++;
    return route.fulfill({ json: [{
    id: "synthetic", pathname: "test-drive/requests/synthetic.enc", name: "Inbox test customer",
    email: "customer@example.invalid", phone: "2025550100", vehicle: "Test vehicle", date: "2099-01-05", time: "10:00 AM",
    }] });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Test-drive requests" })).toHaveCount(0);
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up your passkey" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toHaveCount(0);
  expect(inboxReads).toBe(0);
  expect(inventoryReads).toBe(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set up your passkey" })).toBeVisible();
  expect(inboxReads).toBe(0);
  // Real WebAuthn and setup-token consumption are covered by integration tests.
  state = "authenticated";
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox test customer" })).toHaveCount(0);
});
