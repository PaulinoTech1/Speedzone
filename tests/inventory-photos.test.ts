import { describe, expect, it, vi } from "vitest";

import {
  createInventoryPhotoPath,
  isInventoryPhotoPath,
  isInventoryPhotoUrl,
} from "@/lib/inventory-photos";

describe("inventory photo validation", () => {
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
