import { expect, test } from "@playwright/test";

const base = "/Security_Console";

test("console entry redirects to its own login and renders the form", async ({ page, request }) => {
  const response = await request.get(base, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe(`${base}/login`);
  await page.goto(base);
  await expect(page).toHaveURL(new RegExp(`${base}/login$`));
  await expect(page.getByRole("heading", { name: "Security console", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to passkey" })).toBeVisible();
  await expect(page.getByRole("link", { name: "First-time setup" })).toHaveCount(0);
  expect((await request.get(`${base}/setup`)).status()).toBe(404);
  expect((await request.post(`${base}/api/auth/setup`, { data: {} })).status()).toBe(404);
});

test("admin cookies do not unlock console pages or APIs", async ({ request }) => {
  const headers = { Cookie: `speedzone_admin=${"a".repeat(43)}` };
  for (const path of ["", "/reports", "/integrity", "/events/example", "/passkeys", "/login/passkey"]) {
    const response = await request.get(`${base}${path}`, { headers, maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toBe(`${base}/login`);
  }
  for (const path of ["/api/events", "/api/auth/sessions", "/api/auth/passkeys"]) {
    const response = await request.get(`${base}${path}`, { headers });
    expect(response.status(), path).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  const delivery = await request.post(`${base}/api/delivery-test`, { headers });
  expect(delivery.status()).toBe(401);
});

test("public footer points to the console and retired APIs stay absent", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('href="https://www.speedzonems.com/Security_Console"');
  for (const path of ["events", "delivery-test", "auth/login", "auth/logout", "auth/setup", "auth/passkeys", "auth/sessions"]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const retired = await request.fetch(`/api/security-console/${path}`, { method, maxRedirects: 0 });
      expect(retired.status(), `${method} ${path}`).toBe(404);
    }
  }
});
