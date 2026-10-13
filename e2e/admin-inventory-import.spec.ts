import { expect, test } from "@playwright/test";
import path from "node:path";

test.use({ baseURL: "http://localhost:4184" });

test("DealerCenter CSV import previews a diff before applying", async ({ page }) => {
  const requests: Array<{ mode: string; digest?: string; ifMatch?: string }> = [];
  await page.route("**/api/admin/session", route => route.fulfill({ json: { state: "authenticated" } }));
  await page.route("**/api/admin/passkey**", route => route.fulfill({ json: { passkeys: [] } }));
  await page.route("**/api/admin/test-drives", route => route.fulfill({ json: [] }));
  await page.route("**/api/inventory", route => route.fulfill({ json: { vehicles: [], revision: "rev-1" }, headers: { etag: "rev-1" } }));
  await page.route("**/api/admin/inventory-import", async route => {
    const body = route.request().postDataJSON();
    requests.push({ mode: body.mode, digest: body.digest, ifMatch: route.request().headers()["if-match"] });
    const diff = { digest: "d1", fullImport: false, columns: { mapped: { vin: "VIN" }, blocked: ["Customer Name"], ignored: [] }, added: [{ key: "VIN 1HGCM82633A004352", title: "2019 Honda Accord" }], updated: [], removed: [], unchanged: 0, untouchedManual: 0, externalPhotoUrls: 0, errors: [], warnings: [] };
    await route.fulfill({ json: body.mode === "preview" ? { diff, revision: "rev-1" } : { diff, revision: "rev-2", applied: true } });
  });
  await page.goto("/admin");
  const section = page.getByRole("region", { name: "Import from DealerCenter" });
  await section.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../tests/fixtures/dealercenter-sample.synthetic.csv"));
  await section.getByRole("button", { name: "Preview import" }).click();
  await expect(section.getByTestId("import-preview")).toContainText("2019 Honda Accord");
  await expect(section.getByTestId("import-preview")).toContainText("Discarded columns: Customer Name");
  expect(requests).toEqual([{ mode: "preview", digest: undefined, ifMatch: undefined }]);
  await section.getByRole("button", { name: "Apply 1 change" }).click();
  await expect(section.getByRole("status")).toHaveText("Import applied.");
  expect(requests[1]).toEqual({ mode: "apply", digest: "d1", ifMatch: "rev-1" });
});
