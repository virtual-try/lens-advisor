import { test, expect } from "@playwright/test";
import { loader as rootLoader } from "../../app/routes/_index/route";
import { createLoaderArgs } from "../helpers/shopify-auth";

test.describe("Server health and unauthenticated root loader (Step 2)", () => {
  test("health loader returns showForm without shop query parameter", async () => {
    const request = new Request("https://app.test/");
    const result = await rootLoader(createLoaderArgs(request));

    expect(result).toBeDefined();
    expect(result).toHaveProperty("showForm");
    expect((result as { showForm: boolean }).showForm).toBe(true);
  });

  test("root loader redirects to /app when shop parameter is present", async () => {
    const request = new Request("https://app.test/?shop=test-shop.myshopify.com");
    let redirected: Response | undefined;

    try {
      await rootLoader(createLoaderArgs(request));
    } catch (response) {
      if (response instanceof Response) {
        redirected = response;
      }
    }

    expect(redirected).toBeDefined();
    expect(redirected?.status).toBe(302);
    expect(redirected?.headers.get("Location")).toBe("/app?shop=test-shop.myshopify.com");
  });
});
