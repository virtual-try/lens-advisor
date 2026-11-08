import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { action as optionValueAction } from "../../app/routes/app.options.$id";
import { action as addOnAction } from "../../app/routes/app.add-ons.$id";
import { loader as optionsIndexLoader } from "../../app/routes/app.options._index";
import {
  createActionArgs,
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
import { seedShop, seedOptionGroup } from "../helpers/seed";

test.describe("Spec 33 Flow 3: Admin Options and Add-ons (admin-options)", () => {
  let db: TestDb;

  test.beforeAll(async () => {
    db = await getSharedTestDb();
    setupShopifyMock();
  });

  test.afterAll(async () => {
    teardownShopifyMock();
  });

  test("Flow 3: Create option group with a priced value and an add-on -> priced value gets a variant; zero-price does not", async () => {
    setMockPlanActive(true);
    const domain = "options-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    // 1. Seed an option group through catalog service
    const group = await seedOptionGroup(shopId, {
      kind: "MATERIAL",
      name: "Lens Material",
    });

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
    await optionValueAction(createActionArgs(pricedReq, { id: "new" }));

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
    await optionValueAction(createActionArgs(zeroPriceReq, { id: "new" }));

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
    await addOnAction(createActionArgs(addOnReq, { id: "new" }));

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
