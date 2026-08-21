import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4183";
const shutdownToken = "ISorISorISorISorISorISorISorISorISorISorISo";

export default async function globalSetup() {
  const dataRoot = resolve(process.cwd(), ".data");
  const e2eRoot = resolve(dataRoot, "e2e");

  // Keep recursive cleanup pinned to this exact test directory. A changed or
  // unexpectedly resolved path fails closed before touching the filesystem.
  if (relative(dataRoot, e2eRoot) !== "e2e") {
    throw new Error("Refusing to clean an unexpected E2E state path");
  }

  await rm(e2eRoot, { recursive: true, force: true });

  return async () => {
    const response = await fetch(`${baseURL}/__speedzone_e2e_shutdown`, {
      method: "POST",
      headers: { "x-speedzone-e2e-token": shutdownToken },
    });
    if (response.status !== 204) {
      throw new Error(`The isolated E2E server rejected shutdown (${response.status})`);
    }

    // Wait until the local listener has actually closed. This prevents
    // Playwright's Windows fallback from racing the cooperative shutdown.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      try {
        await fetch(`${baseURL}/api/admin/csrf`, {
          signal: AbortSignal.timeout(250),
        });
      } catch {
        return;
      }
    }
    throw new Error("The isolated E2E server did not stop within the timeout");
  };
}
