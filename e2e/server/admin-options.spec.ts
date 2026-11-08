import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { action as optionValueAction } from "../../app/routes/app.options.$id";
import { action as addOnAction } from "../../app/routes/app.add-ons.$id";
import {
  action as optionsIndexAction,
  loader as optionsIndexLoader,
} from "../../app/routes/app.options._index";
import {
  createActionArgs,
  createAdminUrl,
  createAuthHeaders,
  createLoaderArgs,
  getResponseStatus,
  unwrapData,
} from "../helpers/shopify-auth";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedShop } from "../helpers/seed";

test.describe("Spec 33 Flow 3: Admin Options and Add-ons (admin-options)", () => {
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

  test("Flow 3: Create option group with a priced value and an add-on -> priced value gets a variant; zero-price does not", async () => {
    setMockPlanActive(true);
    // Assert clean DB state before seeding (R3-F4 per-test isolation)
    expect(await db.prisma.shop.count()).toBe(0);

    const domain = "options-flow-shop.myshopify.com";
    await seedShop(db.prisma, domain);

    // 1. Create an option group via admin index action (R4-F3)
    const groupReq = new Request(createAdminUrl("/app/options", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "create_group",
        name: "Lens Material",
        kind: "MATERIAL",
      }),
    });
    const groupRes = await optionsIndexAction(createActionArgs(groupReq));
    const groupData = await unwrapData<{
      ok: boolean;
      group: { id: string; name: string; kind: string };
    }>(groupRes);
    expect(groupData.ok).toBe(true);
    expect(groupData.group.id).toBeTruthy();
    expect(groupData.group.name).toBe("Lens Material");
    const group = groupData.group;

    // 2. Create a priced option value (+35.00) via options action
    const pricedReq = new Request(createAdminUrl("/app/options/new", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "save",
        optionGroupId: group.id,
        label: "1.67 High Index",
        priceDelta: "35.00",
        token: "material=HI167",
      }),
    });
    const pricedRes = await optionValueAction(createActionArgs(pricedReq, { id: "new" }));
    expect(getResponseStatus(pricedRes)).toBe(200);
    const pricedData = await unwrapData<{
      ok: boolean;
      syncFailed: boolean;
      optionValue: {
        id: string;
        label: string;
        priceDelta: { amountMinor: number };
        shopifyVariantId: string | null;
      };
    }>(pricedRes);
    expect(pricedData.ok).toBe(true);
    expect(pricedData.syncFailed).toBe(false);
    expect(pricedData.optionValue).toBeDefined();
    expect(pricedData.optionValue.label).toBe("1.67 High Index");
    expect(pricedData.optionValue.priceDelta.amountMinor).toBe(3500);
    expect(pricedData.optionValue.shopifyVariantId).toBeTruthy();

    // 3. Create a zero-priced option value (0.00) via options action
    const zeroPriceReq = new Request(createAdminUrl("/app/options/new", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "save",
        optionGroupId: group.id,
        label: "Standard Plastic",
        priceDelta: "0.00",
        token: "material=CR39",
      }),
    });
    const zeroPriceRes = await optionValueAction(createActionArgs(zeroPriceReq, { id: "new" }));
    expect(getResponseStatus(zeroPriceRes)).toBe(200);
    const zeroPriceData = await unwrapData<{
      ok: boolean;
      syncFailed: boolean;
      optionValue: {
        id: string;
        label: string;
        priceDelta: { amountMinor: number };
        shopifyVariantId: string | null;
      };
    }>(zeroPriceRes);
    expect(zeroPriceData.ok).toBe(true);
    expect(zeroPriceData.syncFailed).toBe(false);
    expect(zeroPriceData.optionValue).toBeDefined();
    expect(zeroPriceData.optionValue.label).toBe("Standard Plastic");
    expect(zeroPriceData.optionValue.priceDelta.amountMinor).toBe(0);
    expect(zeroPriceData.optionValue.shopifyVariantId).toBeNull();

    // 4. Create an add-on (+25.00) via add-ons action
    const addOnReq = new Request(createAdminUrl("/app/add-ons/new", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "save",
        name: "Blue Light Filter",
        price: "25.00",
      }),
    });
    const addOnRes = await addOnAction(createActionArgs(addOnReq, { id: "new" }));
    expect(getResponseStatus(addOnRes)).toBe(200);
    const addOnData = await unwrapData<{
      ok: boolean;
      syncFailed: boolean;
      addOn: {
        id: string;
        name: string;
        price: { amountMinor: number };
        shopifyVariantId: string | null;
      };
    }>(addOnRes);
    expect(addOnData.ok).toBe(true);
    expect(addOnData.syncFailed).toBe(false);
    expect(addOnData.addOn).toBeDefined();
    expect(addOnData.addOn.name).toBe("Blue Light Filter");
    expect(addOnData.addOn.price.amountMinor).toBe(2500);
    expect(addOnData.addOn.shopifyVariantId).toBeTruthy();

    // 5. Query index loader to inspect options and add-ons
    const listReq = new Request(createAdminUrl("/app/options", domain), {
      headers: createAuthHeaders(domain),
    });

    const loaderResponse = await optionsIndexLoader(createLoaderArgs(listReq));
    const loaderData = await unwrapData<{
      groups: Array<{
        id: string;
        name: string;
        values: Array<{
          id: string;
          label: string;
          priceDelta: { amountMinor: number };
          shopifyVariantId: string | null;
        }>;
      }>;
      addOns: Array<{
        id: string;
        name: string;
        price: { amountMinor: number };
        shopifyVariantId: string | null;
      }>;
    }>(loaderResponse);

    const loadedGroup = loaderData.groups.find((g) => g.id === group.id);
    expect(loadedGroup).toBeDefined();

    // Priced value gets a variant
    const pricedVal = loadedGroup?.values.find((v) => v.label === "1.67 High Index");
    expect(pricedVal).toBeDefined();
    expect(pricedVal?.priceDelta.amountMinor).toBe(3500);
    expect(pricedVal?.shopifyVariantId).toBeTruthy();
    expect(pricedVal?.shopifyVariantId).toContain("gid://shopify/ProductVariant/");

    // Zero-price does not get a variant
    const zeroVal = loadedGroup?.values.find((v) => v.label === "Standard Plastic");
    expect(zeroVal).toBeDefined();
    expect(zeroVal?.priceDelta.amountMinor).toBe(0);
    expect(zeroVal?.shopifyVariantId).toBeNull();

    // Add-on gets a variant
    const blueLight = loaderData.addOns.find((a) => a.name === "Blue Light Filter");
    expect(blueLight).toBeDefined();
    expect(blueLight?.price.amountMinor).toBe(2500);
    expect(blueLight?.shopifyVariantId).toBeTruthy();
    expect(blueLight?.shopifyVariantId).toContain("gid://shopify/ProductVariant/");
  });
});
