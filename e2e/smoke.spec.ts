import { test, expect } from "@playwright/test";

test("home shell renders", async ({ page }) => {
  test.skip(!process.env.E2E, "Set E2E=1 and run the web app before this test");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kazi, Kabla ya Daktari" })).toBeVisible();
});
