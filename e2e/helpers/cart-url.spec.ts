import { test, expect } from "@playwright/test";
import { buildCartUrl } from "./cart-url";

test.describe("buildCartUrl helper (e2e/helpers)", () => {
  test("resolves /cart.js from a full storefront product URL", () => {
    const productUrl =
      "https://my-store.myshopify.com/products/acetate-frames-classic?variant=123";
    const cartUrl = buildCartUrl(productUrl);
    expect(cartUrl).toBe("https://my-store.myshopify.com/cart.js");
  });

  test("resolves /cart.js from an origin URL with trailing slash", () => {
    const origin = "https://my-store.myshopify.com/";
    const cartUrl = buildCartUrl(origin);
    expect(cartUrl).toBe("https://my-store.myshopify.com/cart.js");
  });

  test("resolves /cart.js from an origin URL without trailing slash", () => {
    const origin = "https://my-store.myshopify.com";
    const cartUrl = buildCartUrl(origin);
    expect(cartUrl).toBe("https://my-store.myshopify.com/cart.js");
  });

  test("accepts paths without a leading slash", () => {
    const origin = "https://my-store.myshopify.com";
    const cartUrl = buildCartUrl(origin, "cart.js");
    expect(cartUrl).toBe("https://my-store.myshopify.com/cart.js");
  });

  test("supports custom cart endpoints such as /cart/clear.js", () => {
    const pageUrl = "https://my-store.myshopify.com/collections/frontpage";
    const cartUrl = buildCartUrl(pageUrl, "/cart/clear.js");
    expect(cartUrl).toBe("https://my-store.myshopify.com/cart/clear.js");
  });
});
