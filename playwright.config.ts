import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4183", ...devices["iPhone 13"], browserName: "chromium" },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname localhost --port 4183",
    url: "http://localhost:4183", reuseExistingServer: false,
  },
});
