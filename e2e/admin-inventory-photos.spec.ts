import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const onePixelJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64",
);
const png = readFileSync(resolve("public/assets/speedzone-logo-v1.png"));
const webp = readFileSync(resolve("public/inventory/10841-civic.webp"));

const photoFiles = [
  { name: "vehicle-front.jpg", mimeType: "image/jpeg", buffer: onePixelJpeg },
  { name: "vehicle-side.png", mimeType: "image/png", buffer: png },
  { name: "vehicle-rear.webp", mimeType: "image/webp", buffer: webp },
];

async function mockAdminSession(page: Page) {
  await page.route("**/api/admin/session", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "authenticated" }) }));
  await page.route("**/api/admin/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));
  await page.route("**/api/admin/passkey**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ passkeys: [] }),
  }));
  await page.route("**/api/admin/test-drives", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([]),
  }));
}

async function signIn(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("an admin can read and preview JPEG, PNG, and WebP photos", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      cspErrors.push(message.text());
    }
  });

  await mockAdminSession(page);
  await page.route("**/api/inventory", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([]),
  }));

  await signIn(page);
  await page.locator("#inventory-photo-picker").setInputFiles(photoFiles);

  await expect(page.locator(".vehicle-form .form-message")).toContainText("3 photos added");
  const previews = page.locator(".photo-selection.admin-card .photo-selection-grid img");
  await expect(previews).toHaveCount(3);
  await expect.poll(async () => previews.evaluateAll((images) => images.every((image) => {
    const photo = image as HTMLImageElement;
    return photo.complete && photo.naturalWidth > 0;
  }))).toBe(true);
  expect(cspErrors).toEqual([]);
});

test("the Add photos button uploads sequentially and appends to an existing listing", async ({ page }) => {
  const existingPhoto = "https://test.public.blob.vercel-storage.com/inventory/photos/existing.webp";
  let inventory = [{
    id: "honda-civic",
    year: 2022,
    make: "Honda",
    model: "Civic",
    price: 18_000,
    mileage: 32_000,
    condition: "Used",
    description: "",
    status: "available",
    photos: [existingPhoto],
    createdAt: "2026-09-09T00:00:00.000Z",
  }];
  let activeUploads = 0;
  let maximumActiveUploads = 0;
  let uploadCount = 0;
  let patchBody: { id: string; photos: string[] } | undefined;

  await mockAdminSession(page);
  await page.route("**/api/inventory/upload", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(route.request().method() === "GET" ? { ready: true } : { clientToken: "vercel_blob_client_test_token" }),
  }));
  await page.route("https://vercel.com/api/blob**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
      return;
    }

    activeUploads += 1;
    maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
    uploadCount += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    const pathname = new URL(route.request().url()).searchParams.get("pathname");
    const url = `https://test.public.blob.vercel-storage.com/${pathname}`;
    activeUploads -= 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        url,
        downloadUrl: `${url}?download=1`,
        pathname,
        contentType: "image/webp",
        contentDisposition: "inline",
        etag: `test-etag-${uploadCount}`,
      }),
    });
  });
  await page.route("https://test.public.blob.vercel-storage.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/webp",
    body: webp,
  }));
  await page.route("**/api/inventory", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON() as { id: string; photos: string[] };
      const current = inventory[0];
      if (!current) throw new Error("Expected the existing listing");
      const updated = { ...current, photos: [...current.photos, ...patchBody.photos] };
      inventory = [updated];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(updated),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(inventory),
    });
  });

  await signIn(page);
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add photos to 2022 Honda Civic" }).click();
  await (await fileChooser).setFiles(photoFiles.slice(0, 2));

  await expect(page.locator(".admin-grid > div").last().getByRole("status")).toContainText(
    "2 photos added to 2022 Honda Civic",
  );
  const listing = page.locator(".admin-listing", { hasText: "2022 Honda Civic" });
  await expect(listing).toContainText("3 photos");
  expect(uploadCount).toBe(2);
  expect(maximumActiveUploads).toBe(1);
  expect(patchBody).toEqual({
    id: "honda-civic",
    photos: inventory[0]?.photos.slice(1),
  });
  expect(inventory[0]?.photos[0]).toBe(existingPhoto);

  await page.reload();
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".admin-listing", { hasText: "2022 Honda Civic" })).toContainText("3 photos");
});
