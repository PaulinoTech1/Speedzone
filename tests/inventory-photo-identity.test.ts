import { expect, it } from "vitest";
import { canonicalInventoryPhotoUrl, inventoryPhotoStateKey } from "../src/lib/inventory-state";
import { diagnoseInventoryPhotoUrl } from "../src/lib/inventory-photos";

it("alternate URL spellings cannot escape the same photo deletion marker", () => {
  const canonical = "https://test.public.blob.vercel-storage.com/inventory/photos/example.webp";
  const variant = " HTTPS://TEST.public.blob.vercel-storage.com/inventory/photos/example.webp ";
  expect(canonicalInventoryPhotoUrl(variant)).toBe(canonical);
  expect(inventoryPhotoStateKey(variant)).toBe(inventoryPhotoStateKey(canonical));
  expect(diagnoseInventoryPhotoUrl(variant)).toBe("photo URL must use its canonical form");
});
