import { resolve } from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "server-only": resolve(import.meta.dirname, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
    fileParallelism: false,
    coverage: { reporter: ["text", "json-summary"] },
  },
});
