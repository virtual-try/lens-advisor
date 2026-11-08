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

    // If store is password protected, authenticate with web-first assertions
    if (page.url().includes("/password") && password) {
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.fill(password);
      await page.locator('button[type="submit"]').click();
      await expect(passwordInput).not.toBeVisible();
    }

    // Require a product-specific element and the Select lenses control to be visible
    const productElement = page
      .locator('h1, .product__title, form[action*="/cart/add"], [data-la-mount]')
      .first();
    await expect(productElement).toBeVisible();

    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await expect(selectLensesBtn).toBeVisible();
  });
});
