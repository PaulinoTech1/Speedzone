import { expect, type Page, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

test.describe("mobile public site", () => {
  test("home page presents the dealership and interactive car-care guidance", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/SpeedZone Motorsports/);
    await expect(
      page.getByRole("heading", { name: /Find your perfect ride at unbeatable prices/i }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Quick contact" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/#maintenance");
    await expect(page.getByRole("heading", { name: /Put care in\. Get more miles out\./i })).toBeVisible();
    await expect(page.getByText(/Maintenance is an investment in the car you already own/i)).toBeVisible();

    await page.getByRole("button", { name: "Warning signs" }).click();
    await expect(page.getByText("4 tips shown")).toBeVisible();
    await expect(page.locator("details[data-tip-groups]:visible")).toHaveCount(4);

    const warningTip = page.locator("summary").filter({ hasText: "Act on warning lights" });
    await warningTip.click();
    await expect(
      page.getByText(/A quick response can keep a developing problem from causing more damage/i),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const administratorLink = page.getByRole("link", { name: "Administrator sign in" });
    await expect(administratorLink).toHaveAttribute("href", "/admin/login");
    await administratorLink.click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  });

  test("Road Trip exposes 16 low-cost stops and expandable planning details", async ({ page }) => {
    await page.goto("/road-trip");

    await expect(page.getByRole("heading", { level: 1, name: "Road Trip" })).toBeVisible();
    await expect(page.getByText("16 family stops", { exact: true })).toBeVisible();
    await expect(page.locator("article.trip-card")).toHaveCount(16);

    const firstCard = page.locator("article.trip-card").first();
    await firstCard.getByText("Plan this stop", { exact: true }).click();
    await expect(firstCard.locator("details > p")).toBeVisible();
    await expect(firstCard.getByRole("link", { name: /Official details/i })).toHaveAttribute(
      "rel",
      /noopener/,
    );
    await expectNoHorizontalOverflow(page);
  });

  test("public inventory renders its mobile empty state without exposing drafts", async ({ page }) => {
    await page.goto("/inventory");

    await expect(page.getByRole("heading", { level: 1, name: "Current inventory" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "0 vehicles available" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New arrivals are on the way." })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
