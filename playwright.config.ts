import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:4183",
    ...devices["iPhone 13"],
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname localhost --port 4183",
    env: { SPEEDZONE_E2E: "1", INVENTORY_E2E_FIXTURE: "listing" },
    url: "http://localhost:4183", reuseExistingServer: false,
  },
});
