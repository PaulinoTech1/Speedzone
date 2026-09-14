import { expect, test } from "@playwright/test";

test("embedded console pages and APIs are retired", async ({ request }) => {
  const pages = ["", "/login", "/login/passkey", "/setup", "/passkeys", "/reports", "/integrity", "/events/example"];
  const apis = ["events", "delivery-test", "auth/login", "auth/logout", "auth/setup", "auth/passkeys", "auth/sessions"];
  for (const path of [...pages.map(path => `/Security_Console${path}`), ...apis.map(path => `/api/security-console/${path}`)]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const response = await request.fetch(path, { method, maxRedirects: 0 });
      expect(response.status(), `${method} ${path}`).toBe(404);
      expect(response.headers()["set-cookie"], `${method} ${path}`).toBeUndefined();
    }
  }
});

test("public footer links to the requested console address", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('href="https://www.speedzonems.com/Security_Console"');
});
