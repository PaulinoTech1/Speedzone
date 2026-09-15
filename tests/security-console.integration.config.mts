import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/security-console-flow.integration.ts"], testTimeout: 30000 } });
