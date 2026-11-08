import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { loader as homeLoader } from "../../app/routes/app._index";
import {
  createAdminUrl,
  createAuthHeaders,
  createLoaderArgs,
} from "../helpers/shopify-auth";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedShop } from "../helpers/seed";

test.describe("Spec 33 Flow 1: Shop with no plan opens admin (admin-plan)", () => {
  let db: TestDb;

  test.beforeAll(async () => {
    db = await getSharedTestDb();
    setupShopifyMock();
  });

  test.afterAll(async () => {
    teardownShopifyMock();
  });

  test.beforeEach(async () => {
    await resetSharedTestDb();
  });

  test("Flow 1: Shop with no plan opens admin -> redirect to plan selection", async () => {
    setMockPlanActive(false);
    expect(await db.prisma.shop.count()).toBe(0);

    const domain = "no-plan-shop.myshopify.com";
    await seedShop(db.prisma, domain);

    // 2. Build authenticated request
    const url = createAdminUrl("/app", domain);
    const request = new Request(url, {
      method: "GET",
      headers: createAuthHeaders(domain),
    });

    // 3. requireActivePlan throws a redirect response when the shop has no plan
    let thrownResponse: Response | undefined;
    try {
      await homeLoader(createLoaderArgs(request));
    } catch (err) {
      if (err instanceof Response) {
        thrownResponse = err;
      }
    }

    expect(thrownResponse).toBeDefined();
    // App Bridge API redirect returns 401 with reauthorize header; document redirect returns 302/307
    expect([302, 307, 401]).toContain(thrownResponse?.status);
    const redirectUrl =
      thrownResponse?.headers.get("Location") ??
      thrownResponse?.headers.get("X-Shopify-Redirect") ??
      thrownResponse?.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url");
    expect(redirectUrl).toBeTruthy();
    expect(redirectUrl).toContain("pricing_plans");
  });
});
