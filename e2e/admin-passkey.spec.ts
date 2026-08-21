import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request as PlaywrightRequest,
} from "@playwright/test";

const administrator = "administrator";
const password = "SpeedZone-E2E-Password-2026!";
const bootstrapToken = "ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE";
// This deterministic test-only master secret mirrors playwright.config.ts so the E2E
// process can verify cookie claims without exposing a production decoder.
const cookieSecret = "GxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxs";
const tokenAad = Buffer.from("speedzone-auth-token-v1", "utf8");

const cookieNames = {
  preAuth: "__Host-sz-preauth",
  bootstrap: "__Host-sz-bootstrap",
  session: "__Host-sz-session",
  csrf: "__Host-sz-csrf-seed",
} as const;

type AuthCookieClaims = {
  typ: string;
  sid?: string;
  bind?: string;
  token?: string;
};

function tokenKey(value: string): Buffer {
  return createHash("sha256").update(Buffer.from(value, "base64url")).digest();
}

function derivedCookieSecret(purpose: "cookie-encryption" | "cookie-signing"): string {
  return createHmac("sha256", Buffer.from(cookieSecret, "base64url"))
    .update(`speedzone:${purpose}:v1`, "utf8")
    .digest("base64url");
}

function openFixtureToken(token: string): AuthCookieClaims {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Malformed E2E auth token");
  const [version, ivPart, encryptedPart, signaturePart] = parts;
  const unsigned = `${version}.${ivPart}.${encryptedPart}`;
  const providedSignature = Buffer.from(signaturePart ?? "", "base64url");
  const expectedSignature = createHmac(
    "sha256",
    tokenKey(derivedCookieSecret("cookie-signing")),
  ).update(unsigned).digest();
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error("E2E auth token signature did not verify");
  }

  const encrypted = Buffer.from(encryptedPart ?? "", "base64url");
  if (encrypted.length <= 16) throw new Error("Malformed E2E auth token ciphertext");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenKey(derivedCookieSecret("cookie-encryption")),
    Buffer.from(ivPart ?? "", "base64url"),
  );
  decipher.setAAD(tokenAad);
  decipher.setAuthTag(encrypted.subarray(-16));
  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, -16)),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as AuthCookieClaims;
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

async function contextCookies(context: BrowserContext): Promise<Map<string, string>> {
  return new Map((await context.cookies()).map((cookie) => [cookie.name, cookie.value]));
}

function requiredCookie(cookies: Map<string, string>, name: string): string {
  const value = cookies.get(name);
  if (!value) throw new Error(`Missing required E2E cookie: ${name}`);
  return value;
}

async function requestCookies(request: PlaywrightRequest): Promise<Map<string, string>> {
  return parseCookieHeader((await request.allHeaders()).cookie);
}

async function signInWithPasskey(page: Page, context: BrowserContext) {
  const optionsRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/admin/auth/webauthn/options"
  );

  await page.getByLabel("Administrator ID").fill(administrator);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue with passkey" }).click();

  const preAuthRequestCookies = await requestCookies(await optionsRequestPromise);
  const preAuthToken = requiredCookie(preAuthRequestCookies, cookieNames.preAuth);
  const preAuthClaims = openFixtureToken(preAuthToken);
  expect(preAuthClaims).toMatchObject({ typ: "preauth-v1" });
  expect(preAuthClaims.sid).toBeTruthy();
  expect(preAuthRequestCookies.has(cookieNames.session)).toBe(false);

  const preAuthCsrfClaims = openFixtureToken(
    requiredCookie(preAuthRequestCookies, cookieNames.csrf),
  );
  expect(preAuthCsrfClaims).toMatchObject({ typ: "csrf-v1", bind: preAuthClaims.sid });

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();

  const authenticatedCookies = await contextCookies(context);
  expect(authenticatedCookies.has(cookieNames.preAuth)).toBe(false);
  const sessionToken = requiredCookie(authenticatedCookies, cookieNames.session);
  const sessionClaims = openFixtureToken(sessionToken);
  expect(sessionClaims).toMatchObject({ typ: "session-v1" });
  expect(sessionClaims.sid).toBeTruthy();
  expect(sessionClaims.sid).not.toBe(preAuthClaims.sid);

  const sessionCsrfClaims = openFixtureToken(
    requiredCookie(authenticatedCookies, cookieNames.csrf),
  );
  expect(sessionCsrfClaims).toMatchObject({ typ: "csrf-v1", bind: sessionClaims.sid });
  expect(sessionCsrfClaims.token).not.toBe(preAuthCsrfClaims.token);

  return { preAuthClaims, sessionClaims };
}

test("administrator can bootstrap and then sign in with a virtual passkey", async ({
  context,
  page,
}) => {
  await context.credentials.install();
  await page.goto("/admin/setup");

  await expect(page.getByRole("heading", { name: "Set up secure access" })).toBeVisible();
  const bootstrapOptionsRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/admin/auth/bootstrap/options"
  );
  await page.getByLabel("Administrator ID").fill(administrator);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("One-time bootstrap token").fill(bootstrapToken);
  await page.getByLabel("Passkey label").fill("Playwright virtual passkey");
  await page.getByRole("button", { name: "Verify and register passkey" }).click();

  const bootstrapPreAuthCookies = await requestCookies(await bootstrapOptionsRequestPromise);
  const bootstrapPreAuthClaims = openFixtureToken(
    requiredCookie(bootstrapPreAuthCookies, cookieNames.bootstrap),
  );
  expect(bootstrapPreAuthClaims).toMatchObject({ typ: "bootstrap-preauth-v1" });
  expect(bootstrapPreAuthClaims.sid).toBeTruthy();
  expect(bootstrapPreAuthCookies.has(cookieNames.preAuth)).toBe(false);
  expect(bootstrapPreAuthCookies.has(cookieNames.session)).toBe(false);
  const bootstrapCsrfClaims = openFixtureToken(
    requiredCookie(bootstrapPreAuthCookies, cookieNames.csrf),
  );
  expect(bootstrapCsrfClaims).toMatchObject({
    typ: "csrf-v1",
    bind: bootstrapPreAuthClaims.sid,
  });

  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
  await expect.poll(async () => (await context.credentials.get({ rpId: "localhost" })).length).toBe(1);
  const postBootstrapCookies = await contextCookies(context);
  expect(postBootstrapCookies.has(cookieNames.bootstrap)).toBe(false);
  expect(postBootstrapCookies.has(cookieNames.preAuth)).toBe(false);
  expect(postBootstrapCookies.has(cookieNames.session)).toBe(false);

  await page
    .getByRole("checkbox", { name: /I saved these codes somewhere private and offline/i })
    .check();
  await page.getByRole("button", { name: "Continue to fresh sign in" }).click();

  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  const disabledSetup = await page.request.get("/admin/setup");
  expect(disabledSetup.status()).toBe(404);
  const firstLogin = await signInWithPasskey(page, context);
  await expect(page.getByRole("button", { name: /Register a backup passkey/i })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  expect((await contextCookies(context)).has(cookieNames.session)).toBe(false);

  const secondLogin = await signInWithPasskey(page, context);
  expect(secondLogin.preAuthClaims.sid).not.toBe(firstLogin.preAuthClaims.sid);
  expect(secondLogin.sessionClaims.sid).not.toBe(firstLogin.sessionClaims.sid);
  await expect(page.getByRole("button", { name: /Register a backup passkey/i })).toBeVisible();
});
