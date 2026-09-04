import { afterEach, describe, expect, it, vi } from "vitest";

import { sanityConfig } from "@/lib/server/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sanity environment configuration", () => {
  it("accepts the server-only variable names", () => {
    vi.stubEnv("SANITY_PROJECT_ID", "speedzone");
    vi.stubEnv("SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_TOKEN", "editor-token");

    expect(sanityConfig()).toEqual({
      projectId: "speedzone",
      dataset: "production",
      token: "editor-token",
      apiVersion: "2026-09-04",
    });
  });

  it("accepts the aliases provisioned by Vercel's Sanity integration", () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "speedzone");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_WRITE_TOKEN", "write-token");

    expect(sanityConfig()).toEqual({
      projectId: "speedzone",
      dataset: "production",
      token: "write-token",
      apiVersion: "2026-09-04",
    });
  });

  it("rejects mismatched duplicate variables", () => {
    vi.stubEnv("SANITY_PROJECT_ID", "speedzone");
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "anotherproject");

    expect(() => sanityConfig()).toThrow(
      "SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_PROJECT_ID must match",
    );
  });

  it("rejects a partially configured integration", () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "speedzone");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");

    expect(() => sanityConfig()).toThrow(
      "Sanity project ID, dataset, and API write token must all be set together",
    );
  });
});
