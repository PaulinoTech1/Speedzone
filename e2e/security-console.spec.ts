import { expect, test } from "@playwright/test";

// The console now runs as its own Vercel project. Its former mount and
// subdomain on the primary site must 404 and never redirect to the new host.
test.describe("retired console subdomain", () => {
  test.use({ baseURL: "http://localhost:4185" });
  test("every path 404s without redirecting", async ({ request }) => {
    for (const path of ["/", "/login", "/Security_Console", "/Security_Console/login", "/api/auth/login", "/api/events"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(response.headers().location, path).toBeUndefined();
    }
  });
});

test("console mount is absent from the public host and retired APIs stay absent", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).not.toContain("Security_Console");
  expect(html).not.toContain("speedzone-security-console");
  for (const path of ["/Security_Console", "/Security_Console/login", "/Security_Console/api/auth/login", "/Security_Console/api/events"]) {
    for (const method of ["GET", "POST"]) {
      const res = await request.fetch(path, { method, maxRedirects: 0 });
      expect(res.status(), `${method} ${path}`).toBe(404);
      expect(res.headers().location).toBeUndefined();
    }
  }
  expect((await request.get("/admin", { maxRedirects: 0 })).status()).toBe(404);
  for (const path of ["events", "delivery-test", "auth/login", "auth/logout", "auth/setup", "auth/passkeys", "auth/sessions"]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const retired = await request.fetch(`/api/security-console/${path}`, { method, maxRedirects: 0 });
      expect(retired.status(), `${method} ${path}`).toBe(404);
    }
  }
});
