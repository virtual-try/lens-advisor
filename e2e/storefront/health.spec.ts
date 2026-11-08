import { test, expect } from "@playwright/test";

test.describe("Storefront health check (Step 2)", () => {
  test("product page loads on Shopify dev store", async ({ page }) => {
    test.skip(
      !process.env.E2E_STORE_URL,
      "requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL"
    );

    const storeUrl = process.env.E2E_STORE_URL!;
    const password = process.env.E2E_STORE_PASSWORD;

    await page.goto(storeUrl);

    // If store is password protected, enter password
    if (page.url().includes("/password") && password) {
      const passwordInput = page.locator('input[type="password"]');
      if (await passwordInput.isVisible()) {
        await passwordInput.fill(password);
        await page.locator('button[type="submit"]').click();
        await page.waitForLoadState("networkidle");
      }
    }

    expect(await page.title()).toBeTruthy();
  });
});
