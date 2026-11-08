import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { loader as catalogLoader } from "../../app/routes/proxy.catalog";
import { action as prescriptionsAction } from "../../app/routes/proxy.prescriptions";
import {
  createActionArgs,
  createLoaderArgs,
  createSignedProxyRequest,
} from "../helpers/shopify-auth";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedLens, seedLensGroup, seedShop } from "../helpers/seed";

test.describe("Spec 33 Flow 10: Proxy signature verification (proxy-catalog-endpoint, proxy-prescription-endpoints)", () => {
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

  test("Flow 10: Proxy call with bad signature (catalog or prescriptions) returns 401 Unauthorized", async () => {
    setMockPlanActive(true);
    expect(await db.prisma.shop.count()).toBe(0);

    const domain = "proxy-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    const group = await seedLensGroup(shopId, {
      name: "Proxy SV Group",
    });
    await seedLens(shopId, {
      groupId: group.id,
      name: "Proxy Lens",
      priceMinor: 2500,
      currency: "USD",
      rxTypes: ["SINGLE_VISION"],
      sphMin: -4,
      sphMax: 4,
      cylMin: -2,
      cylMax: 2,
    });

    // --- Catalog Endpoint ---
    // 1. Catalog call with missing signature -> 401
    const unsignedCatalogReq = createSignedProxyRequest("/apps/lens-advisor/catalog", domain, {
      unsigned: true,
    });
    const unsignedCatalogRes = await catalogLoader(createLoaderArgs(unsignedCatalogReq));
    expect(unsignedCatalogRes.status).toBe(401);
    const unsignedCatalogJson = (await unsignedCatalogRes.json()) as { error?: { code?: string } };
    expect(unsignedCatalogJson.error?.code).toBe("UNAUTHORIZED");

    // 2. Catalog call with forged signature -> 401
    const forgedCatalogReq = createSignedProxyRequest("/apps/lens-advisor/catalog", domain, {
      forged: true,
    });
    const forgedCatalogRes = await catalogLoader(createLoaderArgs(forgedCatalogReq));
    expect(forgedCatalogRes.status).toBe(401);
    const forgedCatalogJson = (await forgedCatalogRes.json()) as { error?: { code?: string } };
    expect(forgedCatalogJson.error?.code).toBe("UNAUTHORIZED");

    // --- Prescription Endpoint ---
    // 3. Prescriptions call with missing signature -> 401
    const unsignedRxReq = createSignedProxyRequest("/apps/lens-advisor/prescriptions", domain, {
      unsigned: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "MANUAL", prescription: {} }),
    });
    const unsignedRxRes = await prescriptionsAction(createActionArgs(unsignedRxReq));
    expect(unsignedRxRes.status).toBe(401);
    const unsignedRxJson = (await unsignedRxRes.json()) as { error?: { code?: string } };
    expect(unsignedRxJson.error?.code).toBe("UNAUTHORIZED");

    // 4. Prescriptions call with forged signature -> 401
    const forgedRxReq = createSignedProxyRequest("/apps/lens-advisor/prescriptions", domain, {
      forged: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "MANUAL", prescription: {} }),
    });
    const forgedRxRes = await prescriptionsAction(createActionArgs(forgedRxReq));
    expect(forgedRxRes.status).toBe(401);
    const forgedRxJson = (await forgedRxRes.json()) as { error?: { code?: string } };
    expect(forgedRxJson.error?.code).toBe("UNAUTHORIZED");

    // 5. Validly signed catalog call -> 200 OK
    const validCatalogReq = createSignedProxyRequest("/apps/lens-advisor/catalog", domain);
    const validCatalogRes = await catalogLoader(createLoaderArgs(validCatalogReq));
    expect(validCatalogRes.status).toBe(200);
    const catalogData = (await validCatalogRes.json()) as { lensGroups: Array<{ name: string }> };
    expect(catalogData.lensGroups.length).toBeGreaterThan(0);
    expect(catalogData.lensGroups[0].name).toBe("Proxy SV Group");
  });
});
