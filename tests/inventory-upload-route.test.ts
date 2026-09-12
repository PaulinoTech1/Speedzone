import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleUpload: vi.fn<(options: unknown) => Promise<unknown>>(),
  isAdmin: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@/lib/admin-auth", () => ({
  isAdmin: mocks.isAdmin,
  privateResponseHeaders: () => ({ "Cache-Control": "private, no-store, max-age=0" }),
}));

import { POST } from "@/app/api/inventory/upload/route";

function tokenRequest(pathname: string) {
  return new Request("https://speedzone.example/api/inventory/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: null },
    }),
  });
}

describe("inventory photo upload route", () => {
  const originalOrigin = process.env.INVENTORY_BLOB_ORIGIN;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    mocks.handleUpload.mockReset();
    mocks.isAdmin.mockReset();
    process.env.INVENTORY_BLOB_ORIGIN = "https://speedzone.public.blob.vercel-storage.com";
    process.env.BLOB_READ_WRITE_TOKEN = "test-read-write-token";
  });

  afterEach(() => {
    if (originalOrigin === undefined) delete process.env.INVENTORY_BLOB_ORIGIN;
    else process.env.INVENTORY_BLOB_ORIGIN = originalOrigin;
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  it("does not issue an upload token without an admin session", async () => {
    mocks.isAdmin.mockResolvedValue(false);

    const response = await POST(tokenRequest("inventory/photos/photo.webp"));

    expect(response.status).toBe(401);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("rejects malformed token requests", async () => {
    const response = await POST(new Request("https://speedzone.example/api/inventory/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }));

    expect(response.status).toBe(400);
    expect(mocks.isAdmin).not.toHaveBeenCalled();
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("rejects paths outside the inventory photo namespace", async () => {
    mocks.isAdmin.mockResolvedValue(true);

    const response = await POST(tokenRequest("inventory/inventory.json"));

    expect(response.status).toBe(400);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("issues a constrained upload token to an authenticated admin", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.handleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "test-token",
    });

    const response = await POST(tokenRequest("inventory/photos/photo.webp"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      type: "blob.generate-client-token",
      clientToken: "test-token",
    });
    expect(mocks.handleUpload).toHaveBeenCalledOnce();

    const options = mocks.handleUpload.mock.calls[0]?.[0] as {
      onBeforeGenerateToken: () => Promise<{
        allowedContentTypes: string[];
        maximumSizeInBytes: number;
      }>;
    };
    await expect(options.onBeforeGenerateToken()).resolves.toMatchObject({
      allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
      maximumSizeInBytes: 8 * 1024 * 1024,
    });
  });
});
