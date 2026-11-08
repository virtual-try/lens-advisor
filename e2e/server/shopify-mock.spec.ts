import { test, expect } from "@playwright/test";
import { setupShopifyMock, teardownShopifyMock } from "../helpers/shopify-mock";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import { seedShop } from "../helpers/seed";
import { shopifyTestConfig, createSessionToken } from "../helpers/shopify-auth";

test.describe("Shopify Mock Behavior (R1-F8)", () => {
  test.beforeAll(() => {
    setupShopifyMock();
  });

  test.afterAll(() => {
    teardownShopifyMock();
  });

  test.beforeEach(async () => {
    await resetSharedTestDb();
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

  test("R3-F3: seedShop wires testConfig session storage and dummy credentials without real Shopify env", async () => {
    const db = await getSharedTestDb();
    const domain = "testconfig-isolated.myshopify.com";
    const seeded = await seedShop(db.prisma, domain);
    expect(seeded.shopId).toBeTruthy();

    // Verify session stored in testConfig sessionStorage
    const session = await shopifyTestConfig.sessionStorage.loadSession(`offline_${domain}`);
    expect(session).toBeDefined();
    expect(session?.shop).toBe(domain);
    expect(session?.accessToken).toBe("test_offline_token");

    // Verify token signed with testConfig dummy secret
    const token = createSessionToken(domain);
    expect(token).toBeTruthy();
    const parts = token.split(".");
    expect(parts.length).toBe(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { aud?: string };
    expect(payload.aud).toBe(shopifyTestConfig.apiKey);
  });
});
