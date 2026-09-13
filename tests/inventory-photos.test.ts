import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInventoryPhotoPath,
  getInventoryBlobOrigin,
  diagnoseInventoryPhotoUrl,
  isInventoryPhotoPath,
  isInventoryPhotoUrl,
} from "@/lib/inventory-photos";

describe("inventory photo validation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the upload token store despite stale origin and store configuration", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_CurrentStore_test");
    vi.stubEnv("BLOB_STORE_ID", "store_old");
    vi.stubEnv("INVENTORY_BLOB_ORIGIN", "https://old.public.blob.vercel-storage.com");
    expect(getInventoryBlobOrigin()).toBe("https://CurrentStore.public.blob.vercel-storage.com");
    expect(diagnoseInventoryPhotoUrl("https://currentstore.public.blob.vercel-storage.com/inventory/photos/car.webp")).toBeNull();
    expect(diagnoseInventoryPhotoUrl("https://old.public.blob.vercel-storage.com/inventory/photos/car.webp")).toContain("different Blob store");
  });
  it("creates a unique, sanitized inventory photo path", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "photo-id" });

    expect(createInventoryPhotoPath("front view (1).webp")).toBe(
      "inventory/photos/photo-id-frontview1.webp",
    );

    vi.unstubAllGlobals();
  });

  it("accepts only bounded paths within the inventory photo folder", () => {
    expect(isInventoryPhotoPath("inventory/photos/photo-id.webp")).toBe(true);
    expect(isInventoryPhotoPath("inventory/inventory.json")).toBe(false);
    expect(isInventoryPhotoPath("inventory/photos/../inventory.json")).toBe(false);
    expect(isInventoryPhotoPath("avatars/photo-id.webp")).toBe(false);
  });

  it("accepts public Vercel Blob URLs for inventory photos", () => {
    expect(
      isInventoryPhotoUrl(
        "https://store-id.public.blob.vercel-storage.com/inventory/photos/photo-id.webp",
      ),
    ).toBe(true);
  });

  it.each([
    "http://store-id.public.blob.vercel-storage.com/inventory/photos/photo-id.webp",
    "https://public.blob.vercel-storage.com.evil.example/inventory/photos/photo-id.webp",
    "https://store-id.public.blob.vercel-storage.com/inventory/inventory.json",
    "https://example.com/inventory/photos/photo-id.webp",
    "not a URL",
  ])("rejects an invalid inventory photo URL: %s", (url) => {
    expect(isInventoryPhotoUrl(url)).toBe(false);
  });
});
