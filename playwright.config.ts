import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4183";

// These values are deterministic E2E-only fixtures. They are not production
// credentials, and the server state they protect is removed before every run.
const e2eEnvironment: Record<string, string> = {
  ADMIN_ID: "administrator",
  ADMIN_PASSWORD_HASH:
    "$argon2id$v=19$m=19456,p=1,t=2$MDEyMzQ1Njc4OWFiY2RlZg$oRAn0pI1W26JUVjargHWqo9AQzSfzRxvVXIAeZhoCuw",
  ADMIN_PASSWORD_PEPPER: "",
  ADMIN_BOOTSTRAP_TOKEN_HASH:
    "a5dc7e4d521860daf367fdf53cf4b603f17ea47d8ad144425c120dfe682c0556",
  ADMIN_DISABLED: "false",
  AUTH_COOKIE_SECRET: "GxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxs",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_RP_NAME: "SpeedZone Motorsports E2E",
  WEBAUTHN_EXPECTED_ORIGIN: baseURL,
  ALLOW_INSECURE_WEBAUTHN_TEST_ORIGIN: "true",
  VERCEL: "",
  VERCEL_ENV: "",
  LOCAL_STATE_PATH: ".data/e2e/state.json",
  LOCAL_SECURITY_PATH: ".data/e2e/security-consume",
  E2E_SHUTDOWN_TOKEN: "ISorISorISorISorISorISorISorISorISorISorISo",
  AUTH_GLOBAL_CONFIG: "",
  INVENTORY_GLOBAL_CONFIG: "",
  BLOB_PRIVATE_READ_WRITE_TOKEN: "",
  BLOB_PHOTO_READ_WRITE_TOKEN: "",
  BLOB_INVENTORY_READ_WRITE_TOKEN: "",
  BLOB_INVENTORY_STORE_ID: "",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_STORE_ID: "",
  VERCEL_OIDC_TOKEN: "",
  ENABLE_ENCRYPTED_LOCAL_DRAFTS: "true",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 5"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    // Readiness must not depend on configured authentication state. The CSRF
    // endpoint deliberately fails closed until the isolated auth fixture is
    // available, while the public homepage is a valid server-health probe.
    url: baseURL,
    env: e2eEnvironment,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
