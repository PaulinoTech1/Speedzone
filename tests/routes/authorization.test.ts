import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as createInventory } from "@/app/api/admin/inventory/route";
import { POST as beginPasskeyRegistration } from "@/app/api/admin/auth/passkeys/register/options/route";

let testDirectory = "";

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-route-"));
  process.env.LOCAL_STATE_PATH = join(testDirectory, "state.json");
});

afterAll(async () => {
  delete process.env.LOCAL_STATE_PATH;
  await rm(testDirectory, { recursive: true, force: true });
});

describe("inventory route authorization", () => {
  it("rejects a mutation with no complete admin session before parsing input", async () => {
    const request = new NextRequest("http://localhost:4173/api/admin/inventory", {
      method: "POST",
      headers: {
        origin: "http://localhost:4173",
        "content-type": "application/json",
      },
      body: "{}",
    });
    const response = await createInventory(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("rejects passkey enrollment with no complete session", async () => {
    const request = new NextRequest(
      "http://localhost:4173/api/admin/auth/passkeys/register/options",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:4173",
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "Unauthorized key" }),
      },
    );
    const response = await beginPasskeyRegistration(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED" },
    });
  });
});
