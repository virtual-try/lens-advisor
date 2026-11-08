import { test, expect } from "@playwright/test";
import { buildCartUrl } from "../helpers/cart-url";

const STORE_REQUIREMENTS =
  "requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL";

// Valid 1x1 transparent PNG fixture (68 bytes)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("Storefront Configurator Flows (Spec 33 Flows 6–9)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_STORE_URL, STORE_REQUIREMENTS);

    const storeUrl = process.env.E2E_STORE_URL!;
    const password = process.env.E2E_STORE_PASSWORD;

    await page.goto(storeUrl);

    // If storefront is password-protected, authenticate using web-first assertion
    if (page.url().includes("/password") && password) {
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.fill(password);
      await page.locator('button[type="submit"]').click();
      await expect(passwordInput).not.toBeVisible();
    }
  });

  test("Flow 6: product page -> Select lenses -> SV -> manual Rx -> lens -> options -> add-ons -> review -> Add to cart (cart has frame with nested lines, total equals review total)", async ({
    page,
  }) => {
    // 1. Navigate to product page and click "Select lenses" CTA
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await expect(selectLensesBtn).toBeVisible();
    await selectLensesBtn.click();

    // 2. Step 1: Select Prescription Type -> Single Vision (radio)
    await expect(
      page.getByRole("heading", { name: /what will you wear them for/i })
    ).toBeVisible();
    await page.getByRole("radio", { name: /single vision/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 3. Step 2: Enter manual Rx values (OD / OS SPH, PD)
    await expect(
      page.getByRole("heading", { name: /add your prescription/i })
    ).toBeVisible();
    await page.getByRole("textbox", { name: /right eye.*sphere/i }).fill("-2.00");
    await page.getByRole("textbox", { name: /left eye.*sphere/i }).fill("-2.00");
    await page.getByRole("textbox", { name: /pd \(mm\)/i }).fill("63");
    await page.getByRole("button", { name: "Continue" }).click();

    // 4. Step 3: Lens Family selection
    await expect(
      page.getByRole("heading", { name: /choose your lens family/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lens families/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 5. Step 4: Lens selection
    await expect(
      page.getByRole("heading", { name: /choose your lens/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lenses/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 6. Step 5: Options selection (select an option)
    await expect(
      page.getByRole("heading", { name: /fine-tune your lenses/i })
    ).toBeVisible();
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 7. Step 6: Add-ons selection (select an add-on)
    await expect(
      page.getByRole("heading", { name: /extras/i })
    ).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();

    // 8. Step 7: Review step and Add to Cart
    await expect(
      page.getByRole("heading", { name: /check your glasses/i })
    ).toBeVisible();

    // Assert review rows exist for lens, options, extras
    await expect(page.locator(".la-review__item", { hasText: "Lens" })).toBeVisible();
    await expect(page.locator(".la-review__item", { hasText: "Options" })).toBeVisible();
    await expect(page.locator(".la-review__item", { hasText: "Extras" })).toBeVisible();

    // Capture the review total
    const totalElement = page.locator(".la-price-summary__total-amount");
    await expect(totalElement).toBeVisible();
    const reviewTotalText = await totalElement.textContent();
    const reviewTotalCents = Math.round(
      parseFloat(reviewTotalText!.replace(/[^0-9.]/g, "")) * 100
    );

    const addToCartBtn = page.getByRole("button", { name: /add to cart/i });
    await expect(addToCartBtn).toBeVisible();
    await addToCartBtn.click();

    // 9. Verify /cart.js response contains frame and nested child lines
    const cartRes = await page.request.get(buildCartUrl(page.url()));
    expect(cartRes.ok()).toBe(true);
    const cartJson = await cartRes.json();
    expect(cartJson.items.length).toBeGreaterThanOrEqual(4);

    // Frame item
    const frameItem = cartJson.items.find(
      (item: { properties?: Record<string, string> }) =>
        item.properties?._bundle_role === "frame"
    );
    expect(frameItem).toBeDefined();
    const frameKey = frameItem.key;
    expect(frameKey).toBeTruthy();
    const bundleId = frameItem.properties?._bundle_id;
    expect(bundleId).toBeTruthy();

    // Nested Lens line
    const lensItem = cartJson.items.find(
      (item: { properties?: Record<string, string>; parent_id?: string }) =>
        item.properties?._bundle_role === "lens" &&
        (item.parent_id === frameKey || item.properties?._parent_id === frameKey)
    );
    expect(lensItem).toBeDefined();
    expect(lensItem.properties?._bundle_id).toBe(bundleId);

    // Nested Option line
    const optionItem = cartJson.items.find(
      (item: { properties?: Record<string, string>; parent_id?: string }) =>
        item.properties?._bundle_role === "option" &&
        (item.parent_id === frameKey || item.properties?._parent_id === frameKey)
    );
    expect(optionItem).toBeDefined();
    expect(optionItem.properties?._bundle_id).toBe(bundleId);

    // Nested Add-on line
    const addonItem = cartJson.items.find(
      (item: { properties?: Record<string, string>; parent_id?: string }) =>
        item.properties?._bundle_role === "addon" &&
        (item.parent_id === frameKey || item.properties?._parent_id === frameKey)
    );
    expect(addonItem).toBeDefined();
    expect(addonItem.properties?._bundle_id).toBe(bundleId);

    // Cart total equals review total
    expect(cartJson.total_price).toBe(reviewTotalCents);
  });

  test("Flow 7: Rx beyond a lens's SPH limit -> that lens is disabled with its reason", async ({
    page,
  }) => {
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();

    // Step 1: Select Single Vision
    await expect(
      page.getByRole("heading", { name: /what will you wear them for/i })
    ).toBeVisible();
    await page.getByRole("radio", { name: /single vision/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: Enter extreme Rx beyond standard lens limit (-14.00 SPH)
    await expect(
      page.getByRole("heading", { name: /add your prescription/i })
    ).toBeVisible();
    await page.getByRole("textbox", { name: /right eye.*sphere/i }).fill("-14.00");
    await page.getByRole("textbox", { name: /left eye.*sphere/i }).fill("-14.00");
    await page.getByRole("textbox", { name: /pd \(mm\)/i }).fill("63");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: Lens Family selection
    await expect(
      page.getByRole("heading", { name: /choose your lens family/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lens families/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4: Verify limited lens is disabled with explanation from lensStrings.reasons
    await expect(
      page.getByRole("heading", { name: /choose your lens/i })
    ).toBeVisible();
    const disabledCard = page.locator(".la-choice--disabled").first();
    await expect(disabledCard).toBeVisible();
    const disabledInput = disabledCard.locator('input[type="radio"]');
    await expect(disabledInput).toHaveAttribute("aria-disabled", "true");
    await expect(disabledCard.locator(".la-choice__reason")).toContainText(
      /not available for your prescription.*sph.*is beyond/i
    );
  });

  test("Flow 8: upload path with a PNG -> rxRef stored; review says 'Prescription on file'", async ({
    page,
  }) => {
    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();

    // Step 1: Single Vision
    await expect(
      page.getByRole("heading", { name: /what will you wear them for/i })
    ).toBeVisible();
    await page.getByRole("radio", { name: /single vision/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: Switch to Upload tab and upload valid tiny PNG fixture
    await expect(
      page.getByRole("heading", { name: /add your prescription/i })
    ).toBeVisible();
    await page.getByRole("tab", { name: /upload a photo/i }).click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "prescription.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(page.locator(".la-file__name")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: Lens Family
    await expect(
      page.getByRole("heading", { name: /choose your lens family/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lens families/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4: Lens selection
    await expect(
      page.getByRole("heading", { name: /choose your lens/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lenses/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 5: Options
    await expect(
      page.getByRole("heading", { name: /fine-tune your lenses/i })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 6: Extras
    await expect(
      page.getByRole("heading", { name: /extras/i })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 7: Review step displays "Prescription on file"
    await expect(
      page.getByRole("heading", { name: /check your glasses/i })
    ).toBeVisible();
    await expect(page.getByText("Prescription on file")).toBeVisible();

    // Add to cart and assert rxRef stored
    const addToCartBtn = page.getByRole("button", { name: /add to cart/i });
    await expect(addToCartBtn).toBeVisible();
    await addToCartBtn.click();

    const cartRes = await page.request.get(buildCartUrl(page.url()));
    expect(cartRes.ok()).toBe(true);
    const cartJson = await cartRes.json();

    const lensItem = cartJson.items.find(
      (item: { properties?: Record<string, string> }) =>
        item.properties?._bundle_role === "lens"
    );
    expect(lensItem).toBeDefined();
    expect(lensItem.properties?._rx_ref).toBeTruthy();
    expect(lensItem.properties?._rx_ref).toMatch(/^rx_/);
  });

  test("Flow 9: cart properties with storeRxInOrder off -> no Rx value in the cart JSON (/cart.js)", async ({
    page,
  }) => {
    // Explicitly enforce storeRxInOrder: false on catalog settings
    await page.route("**/apps/lens-advisor/catalog*", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (json.settings) {
        json.settings.storeRxInOrder = false;
      }
      await route.fulfill({ json });
    });

    const selectLensesBtn = page.getByRole("button", { name: /select lenses/i });
    await selectLensesBtn.click();

    // Step 1: Single Vision
    await expect(
      page.getByRole("heading", { name: /what will you wear them for/i })
    ).toBeVisible();
    await page.getByRole("radio", { name: /single vision/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: Enter manual Rx values with -2.50 SPH
    await expect(
      page.getByRole("heading", { name: /add your prescription/i })
    ).toBeVisible();
    await page.getByRole("textbox", { name: /right eye.*sphere/i }).fill("-2.50");
    await page.getByRole("textbox", { name: /left eye.*sphere/i }).fill("-2.50");
    await page.getByRole("textbox", { name: /pd \(mm\)/i }).fill("63");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: Lens Family
    await expect(
      page.getByRole("heading", { name: /choose your lens family/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lens families/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4: Lens selection
    await expect(
      page.getByRole("heading", { name: /choose your lens/i })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: /lenses/i })
      .getByRole("radio")
      .first()
      .click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 5: Options
    await expect(
      page.getByRole("heading", { name: /fine-tune your lenses/i })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 6: Extras
    await expect(
      page.getByRole("heading", { name: /extras/i })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 7: Review displays "Prescription on file" (not the raw table)
    await expect(
      page.getByRole("heading", { name: /check your glasses/i })
    ).toBeVisible();
    await expect(page.getByText("Prescription on file")).toBeVisible();

    await page.getByRole("button", { name: /add to cart/i }).click();

    // Verify /cart.js has no raw clinical prescription fields in properties
    const cartRes = await page.request.get(buildCartUrl(page.url()));
    expect(cartRes.ok()).toBe(true);
    const cartJson = await cartRes.json();

    const lensItem = cartJson.items.find(
      (item: { properties?: Record<string, string> }) =>
        item.properties?._bundle_role === "lens"
    );
    expect(lensItem).toBeDefined();
    expect(lensItem.properties?.Prescription).toBe("Prescription on file");
    expect(lensItem.properties?._rx_ref).toBeTruthy();

    const ALLOWED_PROPERTY_KEYS = new Set([
      "_bundle_id",
      "_bundle_role",
      "_item_id",
      "_option_ids",
      "_addon_ids",
      "_rx_ref",
      "_parent_id",
      "Prescription",
    ]);

    const rxForbiddenForms = ["-2.50", "-2.5", "-250", "63", "63.0", "630"];

    for (const item of cartJson.items) {
      const props = (item.properties || {}) as Record<string, unknown>;

      // 1. Allowlist every cart property key (not just _-prefixed ones)
      for (const key of Object.keys(props)) {
        expect(
          ALLOWED_PROPERTY_KEYS.has(key),
          `Unexpected property key: ${key}`
        ).toBe(true);
      }

      // Explicitly assert that no raw clinical keys exist
      expect(props._rx_od).toBeUndefined();
      expect(props._rx_os).toBeUndefined();
      expect(props._rx_pd).toBeUndefined();

      // 2. Scan every property key and value for display and internal-unit representations
      for (const [key, rawVal] of Object.entries(props)) {
        const valStr = String(rawVal);

        // Scan keys for all forbidden Rx forms (-2.50, -2.5, -250, 63, 63.0, 630)
        for (const form of rxForbiddenForms) {
          expect(
            key,
            `Property key ${key} contains forbidden Rx representation ${form}`
          ).not.toContain(form);
        }

        // Substring check for normalized sphere/prescription values and internal PD 630
        for (const form of ["-2.50", "-2.5", "-250", "63.0", "630"]) {
          expect(
            valStr,
            `Property ${key} contains forbidden Rx representation ${form}`
          ).not.toContain(form);
        }

        // PD 63 / 63.0 / PD 63 checks
        expect(
          valStr,
          `Property ${key} contains forbidden PD value`
        ).not.toMatch(/(?:^|[^\w])63(?:\.0)?(?:[^\w]|$)/);
        expect(valStr).not.toMatch(/PD\s*63/i);
        expect(valStr).not.toMatch(/PD\s*630/i);

        // Clinical terminology scan
        expect(valStr.toLowerCase()).not.toContain("sphere");
        expect(valStr.toLowerCase()).not.toContain("cylinder");
        expect(valStr.toLowerCase()).not.toContain("axis");
      }
    }
  });
});
