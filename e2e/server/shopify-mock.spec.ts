import { test, expect } from "@playwright/test";
import { setupShopifyMock, teardownShopifyMock } from "../helpers/shopify-mock";

test.describe("Shopify Mock Behavior (R1-F8)", () => {
  test.beforeAll(() => {
    setupShopifyMock();
  });

  test.afterAll(() => {
    teardownShopifyMock();
  });

  test("R1-F8: unmatched GraphQL query throws an error instead of silently returning empty data", async () => {
    const fetchCall = () =>
      globalThis.fetch("https://test-shop.myshopify.com/admin/api/2026-01/graphql.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "query UnrecognizedOperation { nonExistentField }" }),
      });

    await expect(fetchCall()).rejects.toThrow(/Unmatched Shopify GraphQL query in test mock/);
  });
});
