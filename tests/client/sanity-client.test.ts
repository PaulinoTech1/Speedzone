import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn((configuration: unknown) => configuration));

vi.mock("@sanity/client", () => ({ createClient }));

beforeEach(() => {
  vi.resetModules();
  createClient.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public Sanity client", () => {
  it("uses Vercel's public identifiers without attaching a secret token", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "speedzone");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("NODE_ENV", "production");

    await import("@/sanity/lib/client");

    expect(createClient).toHaveBeenCalledWith({
      projectId: "speedzone",
      dataset: "production",
      apiVersion: "2026-09-04",
      useCdn: true,
    });
    expect(createClient.mock.calls[0]?.[0]).not.toHaveProperty("token");
  });
});
