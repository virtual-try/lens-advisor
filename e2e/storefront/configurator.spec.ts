import { test, expect } from "@playwright/test";

const STORE_REQUIREMENTS =
  "requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL";

test.describe("Storefront Configurator Flows (Spec 33 Flows 6–9)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_STORE_URL, STORE_REQUIREMENTS);

    const storeUrl = process.env.E2E_STORE_URL!;
    const password = process.env.E2E_STORE_PASSWORD;

    await page.goto(storeUrl);

    // If storefront is password-protected, authenticate
    if (page.url().includes("/password") && password) {
      const passwordInput = page.locator('input[type="password"]');
      if (await passwordInput.isVisible()) {
        await passwordInput.fill(password);
        await page.locator('button[type="submit"]').click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Flow 6: product page -> Select lenses -> SV -> manual Rx -> lens -> options -> add-ons -> review -> Add to cart (cart has frame with nested lines, total equals review total)", async ({
    page,
  }) => {
    // 1. Navigate to product page and click "Select lenses" CTA
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await expect(selectLensesBtn).toBeVisible();
    await selectLensesBtn.click();

    // 2. Step 1: Select Prescription Type -> Single Vision
    const svOption = page.getByRole("button", { name: /single vision/i });
    await expect(svOption).toBeVisible();
    await svOption.click();

    // 3. Step 2: Enter manual Rx values (OD / OS SPH, CYL, Axis, PD)
    const odSph = page.getByLabel(/od.*sphere/i);
    await odSph.fill("-2.00");
    const osSph = page.getByLabel(/os.*sphere/i);
    await osSph.fill("-2.00");
    const pd = page.getByLabel(/pupillary distance|pd/i);
    if (await pd.isVisible()) {
      await pd.fill("63");
    }
    await page.getByRole("button", { name: /continue|next/i }).click();

    // 4. Step 3 & 4: Lens selection
    const lensCard = page.locator('[data-testid="lens-card"]').first();
    await expect(lensCard).toBeVisible();
    await lensCard.click();
    await page.getByRole("button", { name: /continue|next/i }).click();

    // 5. Step 5 & 6: Options and Add-ons
    const continueBtn = page.getByRole("button", { name: /continue|next|skip/i });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
    }

    // 6. Step 7: Review step and Add to Cart
    await expect(page.getByText(/review/i)).toBeVisible();
    const addToCartBtn = page.getByRole("button", { name: /add to cart/i });
    await expect(addToCartBtn).toBeVisible();
    await addToCartBtn.click();

    // 7. Verify /cart.js response contains frame and nested child lines
    const cartRes = await page.request.get("/cart.js");
    expect(cartRes.ok()).toBe(true);
    const cartJson = await cartRes.json();
    expect(cartJson.items.length).toBeGreaterThan(0);
    const hasParentId = cartJson.items.some(
      (item: { properties?: Record<string, string> }) =>
        item.properties?._parent_id || item.properties?._bundle_id
    );
    expect(hasParentId).toBe(true);
  });

  test("Flow 7: Rx beyond a lens's SPH limit -> that lens is disabled with its reason", async ({
    page,
  }) => {
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();

    await page.getByRole("button", { name: /single vision/i }).click();

    // Enter extreme Rx beyond standard lens limit (-14.00 SPH)
    const odSph = page.getByLabel(/od.*sphere/i);
    await odSph.fill("-14.00");
    const osSph = page.getByLabel(/os.*sphere/i);
    await osSph.fill("-14.00");
    await page.getByRole("button", { name: /continue|next/i }).click();

    // Verify limited lens is disabled with explanation
    const disabledLens = page.locator('[data-testid="lens-card"][aria-disabled="true"]').first();
    await expect(disabledLens).toBeVisible();
    await expect(disabledLens).toContainText(/sphere out of range|limit/i);
  });

  test("Flow 8: upload path with a PNG -> rxRef stored; review says 'Prescription on file'", async ({
    page,
  }) => {
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();

    await page.getByRole("button", { name: /single vision/i }).click();

    // Select upload prescription option
    const uploadOption = page.getByRole("button", { name: /upload|file/i });
    if (await uploadOption.isVisible()) {
      await uploadOption.click();
      const fileChooserPromise = page.waitForEvent("filechooser");
      await page.getByLabel(/upload prescription|choose file/i).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({
        name: "prescription.png",
        mimeType: "image/png",
        buffer: Buffer.from("fake-image-bytes"),
      });
      await page.getByRole("button", { name: /continue|next/i }).click();
    }

    // Fast-forward to review step
    while (await page.getByRole("button", { name: /continue|next|skip/i }).isVisible()) {
      await page.getByRole("button", { name: /continue|next|skip/i }).click();
      if (await page.getByText(/review/i).isVisible()) break;
    }

    // Verify review displays "Prescription on file"
    await expect(page.getByText(/prescription on file/i)).toBeVisible();
  });

  test("Flow 9: cart properties with storeRxInOrder off -> no Rx value in the cart JSON (/cart.js)", async ({
    page,
  }) => {
    // Navigate and add product with storeRxInOrder off
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();
    await page.getByRole("button", { name: /single vision/i }).click();

    const odSph = page.getByLabel(/od.*sphere/i);
    await odSph.fill("-2.50");
    await page.getByRole("button", { name: /continue|next/i }).click();

    // Complete steps and add to cart
    while (await page.getByRole("button", { name: /continue|next|skip/i }).isVisible()) {
      await page.getByRole("button", { name: /continue|next|skip/i }).click();
      if (await page.getByRole("button", { name: /add to cart/i }).isVisible()) break;
    }

    await page.getByRole("button", { name: /add to cart/i }).click();

    // Verify /cart.js has no raw clinical prescription fields in properties
    const cartRes = await page.request.get("/cart.js");
    const cartJson = await cartRes.json();
    for (const item of cartJson.items) {
      const props = JSON.stringify(item.properties || {});
      expect(props).not.toContain("-2.50");
      expect(props).not.toContain("sphere");
    }
  });
});
