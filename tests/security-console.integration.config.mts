import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ resolve: { alias: { "@": resolve(import.meta.dirname, "../src") } }, test: { environment: "node", include: ["tests/security-console-flow.integration.ts", "tests/admin-security.integration.ts"], testTimeout: 30000 } });
