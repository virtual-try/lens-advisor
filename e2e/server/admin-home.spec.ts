import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { loader as homeLoader } from "../../app/routes/app._index";
import {
  createAdminUrl,
  createAuthHeaders,
  createLoaderArgs,
  unwrapData,
} from "../helpers/shopify-auth";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedLens, seedLensGroup, seedSettings, seedShop } from "../helpers/seed";

test.describe("Spec 33 Flow 5: Admin home setup checklist (admin-home-setup)", () => {
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

  test("Flow 5: Checklist ticks after lens + lab email -> both ticked shows complete", async () => {
    setMockPlanActive(true);
    const domain = "home-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    const makeHomeRequest = async () => {
      const req = new Request(createAdminUrl("/app", domain), {
        headers: createAuthHeaders(domain),
      });
      const res = await homeLoader(createLoaderArgs(req));
      return unwrapData<{
        hasLens: boolean;
        hasLabEmail: boolean;
        apiKey: string;
        themeDeepLink: string;
      }>(res);
    };

    // Step 1: Initial state - nothing configured
    const step1 = await makeHomeRequest();
    expect(step1.hasLens).toBe(false);
    expect(step1.hasLabEmail).toBe(false);
    const initialDone = step1.hasLens && step1.hasLabEmail;
    expect(initialDone).toBe(false);

    // Step 2: Add lens group + lens -> hasLens becomes true
    const group = await seedLensGroup(shopId, {
      name: "Single Vision Group",
    });
    await seedLens(shopId, {
      groupId: group.id,
      name: "Standard Clear 1.50",
      priceMinor: 2900,
      currency: "USD",
      rxTypes: ["SINGLE_VISION"],
      sphMin: -6,
      sphMax: 4,
      cylMin: -2,
      cylMax: 2,
    });

    const step2 = await makeHomeRequest();
    expect(step2.hasLens).toBe(true);
    expect(step2.hasLabEmail).toBe(false);

    // Step 3: Save lab email in settings -> hasLabEmail becomes true
    await seedSettings(shopId, {
      labEmail: ["lab@optical-lab.example"],
    });

    // Reload home data: assert exact checklist items' done flags all true after reload
    const reloaded = await makeHomeRequest();
    expect(reloaded.hasLens).toBe(true);
    expect(reloaded.hasLabEmail).toBe(true);
    const allDataItemsDone = reloaded.hasLens && reloaded.hasLabEmail;
    expect(allDataItemsDone).toBe(true);
  });
});
