import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import * as ReactRouter from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";

import { createTestDb, type TestDb } from "../../../test/db";
import { discoverNavItems } from "../../shared/nav";
import { parseMoneyText } from "../../../packages/rx-core/src/pricing/index.js";
import {
  createCatalogService,
  type CatalogService,
} from "./catalog.service.server";
import { OptionValueForm } from "./components/option-value-form";
import AdminOptionsIndexRoute, {
  action as indexAction,
  loader as indexLoader,
} from "../../routes/app.options._index";
import OptionValueRoute, {
  action as optionValueAction,
  loader as optionValueLoader,
} from "../../routes/app.options.$id";
import AddOnRoute, {
  action as addOnAction,
  loader as addOnLoader,
} from "../../routes/app.add-ons.$id";

const DB_TIMEOUT_MS = 120_000;

const mocks = vi.hoisted(() => ({
  currentShop: "test-shop.myshopify.com",
  toastShow: vi.fn(),
  redirect: vi.fn(),
  adminGraphql: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: mocks.currentShop },
      admin: {
        graphql: mocks.adminGraphql,
      },
      redirect: mocks.redirect,
    })),
  },
}));

vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({
    toast: { show: mocks.toastShow },
  }),
}));

let db: TestDb | undefined;
let catalogService: CatalogService;

function getTestPrisma() {
  if (!db) throw new Error("Test database not initialized");
  return db.prisma;
}

beforeAll(async () => {
  db = await createTestDb();
  (globalThis as Record<string, unknown>).__prismaClient = db.prisma;
  catalogService = createCatalogService({ prisma: db.prisma });
}, DB_TIMEOUT_MS);

afterAll(async () => {
  (globalThis as Record<string, unknown>).__prismaClient = undefined;
  await db?.drop();
}, DB_TIMEOUT_MS);

afterEach(() => {
  cleanup();
});

let createdProductCount = 1;
let createdVariantCount = 100;
const recordedCalls: Array<{ query: string; variables?: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  testConfig();
  recordedCalls.length = 0;

  // Mock Partner API billing fetch
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          activeSubscription: {
            items: [{ handle: "pro-plan", description: "Pro Plan" }],
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );

  // Mock Admin GraphQL for Shopify sync and billing fallback
  mocks.adminGraphql.mockImplementation(
    async (query: string, init?: { variables?: Record<string, unknown> }) => {
      recordedCalls.push({ query, variables: init?.variables });

      if (query.includes("AppPlanShopId")) {
        return new Response(
          JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1001" } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("AppPlanStatus")) {
        return new Response(
          JSON.stringify({
            data: {
              currentAppInstallation: {
                activeSubscriptions: [
                  {
                    id: "gid://shopify/AppSubscription/1",
                    name: "Pro Plan",
                    status: "ACTIVE",
                    test: false,
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("ShopCurrency")) {
        return new Response(
          JSON.stringify({ data: { shop: { currencyCode: "USD" } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("GetPublications")) {
        return new Response(
          JSON.stringify({
            data: {
              publications: {
                nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("GetVariantProduct")) {
        const variantId = (init?.variables?.id as string) ?? "gid://shopify/ProductVariant/unknown";
        return new Response(
          JSON.stringify({
            data: {
              productVariant: {
                id: variantId,
                product: { id: "gid://shopify/Product/existing-product" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("ProductCreate")) {
        const pId = `gid://shopify/Product/${createdProductCount++}`;
        const vId = `gid://shopify/ProductVariant/${createdVariantCount++}`;
        return new Response(
          JSON.stringify({
            data: {
              productCreate: {
                product: {
                  id: pId,
                  variants: {
                    nodes: [{ id: vId, price: "35.00" }],
                  },
                },
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("ProductVariantsBulkUpdate")) {
        return new Response(
          JSON.stringify({
            data: {
              productVariantsBulkUpdate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/100", price: "35.00" }],
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("PublishablePublish")) {
        return new Response(
          JSON.stringify({
            data: {
              publishablePublish: {
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (query.includes("ProductUpdate")) {
        return new Response(
          JSON.stringify({
            data: {
              productUpdate: {
                product: { id: "gid://shopify/Product/1", status: "DRAFT" },
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ data: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );
});

async function createShop(domain: string): Promise<string> {
  const shop = await getTestPrisma().shop.create({
    data: { domain },
  });
  return shop.id;
}

function createActionArgs(
  request: Request,
  params: Record<string, string> = {},
): ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as ActionFunctionArgs;
}

function createLoaderArgs(
  request: Request,
  params: Record<string, string> = {},
): LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as LoaderFunctionArgs;
}

async function unwrapResponse<T = Record<string, unknown>>(
  result: unknown,
): Promise<{ status: number; data: T }> {
  if (result instanceof Response) {
    const data = (await result.clone().json()) as T;
    return { status: result.status, data };
  }
  if (
    result &&
    typeof result === "object" &&
    "data" in result &&
    "init" in result
  ) {
    const res = result as { data: T; init?: { status?: number } };
    return {
      status: res.init?.status ?? 200,
      data: res.data,
    };
  }
  return {
    status: 200,
    data: result as T,
  };
}

describe("Spec 19 — Admin: lens options and add-ons", () => {
  describe("Self-check 2: Nav discovery", () => {
    it("discovers catalog-options/nav.ts via the real nav glob", () => {
      const items = discoverNavItems();
      const optionNav = items.find((item) => item.href === "/app/options");
      expect(optionNav).toBeDefined();
      expect(optionNav?.label).toBe("Options & add-ons");
      expect(optionNav?.order).toBe(20);
    });
  });

  describe("INV-4: Money input converts without floats (table test)", () => {
    const cases = [
      { input: "35.5", currency: "USD", expectedMinor: 3550 },
      { input: "0.1", currency: "USD", expectedMinor: 10 },
      { input: "+35.00", currency: "USD", expectedMinor: 3500 },
      { input: "0", currency: "USD", expectedMinor: 0 },
      { input: "1500", currency: "JPY", expectedMinor: 1500 },
      { input: "1.500", currency: "KWD", expectedMinor: 1500 },
      { input: "100.99", currency: "EUR", expectedMinor: 10099 },
    ];

    cases.forEach(({ input, currency, expectedMinor }) => {
      it(`parses "${input}" in ${currency} → exact integer ${expectedMinor}`, () => {
        const result = parseMoneyText(input, currency);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.amountMinor).toBe(expectedMinor);
          expect(Number.isInteger(result.amountMinor)).toBe(true);
        }
      });
    });
  });

  describe("Examples Table", () => {
    it('Row 1: "1.67 High Index", +35.00, token lens_material=PO-67 -> saved delta 3500; synced (normal)', async () => {
      const shopId = await createShop("shop-ex1.myshopify.com");
      mocks.currentShop = "shop-ex1.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material / Index",
        kind: "MATERIAL",
      });

      const request = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "1.67 High Index",
          priceDelta: "+35.00",
          token: "lens_material=PO-67",
        }),
      });

      const res = await optionValueAction(
        createActionArgs(request, { id: "new" }),
      );
      const unwrapped = await unwrapResponse<{
        ok: boolean;
        optionValue: {
          id: string;
          label: string;
          priceDelta: { amountMinor: number };
          tokenKey: string;
          tokenValue: string;
        };
      }>(res);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.optionValue.label).toBe("1.67 High Index");
      expect(unwrapped.data.optionValue.priceDelta.amountMinor).toBe(3500);
      expect(unwrapped.data.optionValue.tokenKey).toBe("lens_material");
      expect(unwrapped.data.optionValue.tokenValue).toBe("PO-67");

      // Verify product-sync was called
      const productCreateCall = recordedCalls.find((c) =>
        c.query.includes("ProductCreate"),
      );
      expect(productCreateCall).toBeDefined();

      // Verify DB row
      const saved = await catalogService.getOptionValue(
        shopId,
        unwrapped.data.optionValue.id,
      );
      expect(saved?.priceDelta.amountMinor).toBe(3500);
      expect(saved?.shopifyVariantId).toBeTruthy();
    });

    it('Row 2: delta "35.555" -> inline error (max 2 decimals for USD) (money precision)', async () => {
      const shopId = await createShop("shop-ex2.myshopify.com");
      mocks.currentShop = "shop-ex2.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      const request = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "1.67 High Index",
          priceDelta: "35.555",
        }),
      });

      const res = await optionValueAction(
        createActionArgs(request, { id: "new" }),
      );
      const unwrapped = await unwrapResponse<{
        error: { code: string; message: string; fields?: Array<{ path: string; code: string }> };
      }>(res);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("MONEY_PRECISION");
      expect(unwrapped.data.error.message).toContain("Maximum 2 decimal places");

      // Assert no option value row was created
      const values = await catalogService.listOptionValues(shopId, {
        optionGroupId: group.id,
      });
      expect(values.length).toBe(0);
    });

    it('Row 3: delta "-5" -> inline NEGATIVE_PRICE (invalid)', async () => {
      const shopId = await createShop("shop-ex3.myshopify.com");
      mocks.currentShop = "shop-ex3.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      const request = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Discount Option",
          priceDelta: "-5",
        }),
      });

      const res = await optionValueAction(
        createActionArgs(request, { id: "new" }),
      );
      const unwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(res);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("NEGATIVE_PRICE");

      // Assert no option value was created
      const values = await catalogService.listOptionValues(shopId, {
        optionGroupId: group.id,
      });
      expect(values.length).toBe(0);
    });

    it("Row 4: both token and override filled -> inline ONE_CODE_SOURCE (invalid)", async () => {
      const shopId = await createShop("shop-ex4.myshopify.com");
      mocks.currentShop = "shop-ex4.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      const request = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "1.67 High Index",
          priceDelta: "35.00",
          token: "lens_material=PO-67",
          overrideCode: "OVERRIDE-67",
        }),
      });

      const res = await optionValueAction(
        createActionArgs(request, { id: "new" }),
      );
      const unwrapped = await unwrapResponse<{
        error: { code: string; message: string; fields?: Array<{ path: string; code: string }> };
      }>(res);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("ONE_CODE_SOURCE");
      expect(unwrapped.data.error.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "ONE_CODE_SOURCE" }),
        ]),
      );

      // Assert no option value row was created
      const values = await catalogService.listOptionValues(shopId, {
        optionGroupId: group.id,
      });
      expect(values.length).toBe(0);
    });

    it("Row 5: delta 1500 → 0 -> Shopify product drafted, variant id cleared (price removed)", async () => {
      const shopId = await createShop("shop-ex5.myshopify.com");
      mocks.currentShop = "shop-ex5.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      // Create an option value with delta 1500 and variant ID
      const initial = await catalogService.createOptionValue(shopId, {
        optionGroupId: group.id,
        label: "Anti-reflective",
        priceDeltaMinor: 1500,
        shopifyVariantId: "gid://shopify/ProductVariant/555",
      });
      expect(initial.shopifyVariantId).toBe("gid://shopify/ProductVariant/555");
      expect(initial.priceDelta.amountMinor).toBe(1500);

      // Now update delta to 0
      const request = new Request(
        `https://test-shop.myshopify.com/app/options/${initial.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Anti-reflective",
            priceDelta: "0",
          }),
        },
      );

      const res = await optionValueAction(
        createActionArgs(request, { id: initial.id }),
      );
      const unwrapped = await unwrapResponse<{
        ok: boolean;
        optionValue: { priceDelta: { amountMinor: number }; shopifyVariantId: string | null };
      }>(res);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.optionValue.priceDelta.amountMinor).toBe(0);
      expect(unwrapped.data.optionValue.shopifyVariantId).toBeNull();

      // Verify Shopify product was drafted
      const productUpdateCall = recordedCalls.find((c) =>
        c.query.includes("ProductUpdate"),
      );
      expect(productUpdateCall).toBeDefined();

      // Verify in DB directly: variant ID is cleared
      const inDb = await catalogService.getOptionValue(shopId, initial.id);
      expect(inDb?.priceDelta.amountMinor).toBe(0);
      expect(inDb?.shopifyVariantId).toBeNull();
    });
  });

  describe("Invariants", () => {
    it("INV-1: posting another shop's option value id returns 404, nothing changes", async () => {
      const _shopA = await createShop("shop-a.myshopify.com");
      const shopB = await createShop("shop-b.myshopify.com");

      // Shop B creates an option group and option value
      const groupB = await catalogService.createOptionGroup(shopB, {
        name: "Group B",
        kind: "MATERIAL",
      });
      const optValB = await catalogService.createOptionValue(shopB, {
        optionGroupId: groupB.id,
        label: "Option Value B",
        priceDeltaMinor: 2000,
      });

      // Shop A authenticated
      mocks.currentShop = "shop-a.myshopify.com";

      // Shop A tries to post an update targeting Shop B's option value
      const request = new Request(
        `https://shop-a.myshopify.com/app/options/${optValB.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Hacked by Shop A",
            priceDelta: "50.00",
          }),
        },
      );

      const res = await optionValueAction(
        createActionArgs(request, { id: optValB.id }),
      );
      const unwrapped = await unwrapResponse<{ error: { code: string } }>(res);

      expect(unwrapped.status).toBe(404);
      expect(unwrapped.data.error.code).toBe("NOT_FOUND");

      // Verify Shop B's row is completely untouched
      const checkB = await catalogService.getOptionValue(shopB, optValB.id);
      expect(checkB?.label).toBe("Option Value B");
      expect(checkB?.priceDelta.amountMinor).toBe(2000);
    });

    it("INV-1: posting another shop's add-on id returns 404, nothing changes", async () => {
      const _shopA = await createShop("shop-a2.myshopify.com");
      const shopB = await createShop("shop-b2.myshopify.com");

      const addOnB = await catalogService.createAddOn(shopB, {
        name: "AddOn B",
        priceMinor: 1500,
      });

      mocks.currentShop = "shop-a2.myshopify.com";

      const request = new Request(
        `https://shop-a2.myshopify.com/app/add-ons/${addOnB.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Hacked Addon",
            price: "99.00",
          }),
        },
      );

      const res = await addOnAction(
        createActionArgs(request, { id: addOnB.id }),
      );
      const unwrapped = await unwrapResponse<{ error: { code: string } }>(res);

      expect(unwrapped.status).toBe(404);
      expect(unwrapped.data.error.code).toBe("NOT_FOUND");

      const checkB = await catalogService.getAddOn(shopB, addOnB.id);
      expect(checkB?.name).toBe("AddOn B");
      expect(checkB?.price.amountMinor).toBe(1500);
    });
  });

  describe("UI Rendering: Empty and Populated States", () => {
    it("renders empty state across all three sections when catalog has no options or add-ons", async () => {
      await createShop("shop-empty.myshopify.com");
      mocks.currentShop = "shop-empty.myshopify.com";

      const emptyData = {
        groups: [],
        addOns: [],
        plan: { active: true, planName: "Pro Plan", test: false },
        shopDomain: "shop-empty.myshopify.com",
      };

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(emptyData);

      const { container } = render(
        <AdminOptionsIndexRoute />
      );

      expect(container.querySelector("s-page")).not.toBeNull();
      expect(container.querySelector("#empty-materials")).not.toBeNull();
      expect(container.querySelector("#empty-tints")).not.toBeNull();
      expect(container.querySelector("#empty-add-ons")).not.toBeNull();
      expect(
        screen.getByText("No material options yet. Add your first material option."),
      ).toBeTruthy();
      expect(
        screen.getByText("No tint or colour options yet. Add your first tint or colour option."),
      ).toBeTruthy();
      expect(screen.getByText("No add-ons yet. Add your first add-on.")).toBeTruthy();
    });

    it("renders populated state across all three sections with ordered values, badges, and swatches", async () => {
      const shopId = await createShop("shop-populated.myshopify.com");
      mocks.currentShop = "shop-populated.myshopify.com";

      // 1. Material group with values
      const matGroup = await catalogService.createOptionGroup(shopId, {
        name: "Standard Materials",
        kind: "MATERIAL",
      });
      await catalogService.createOptionValue(shopId, {
        optionGroupId: matGroup.id,
        label: "1.50 Standard",
        priceDeltaMinor: 0,
      });
      await catalogService.createOptionValue(shopId, {
        optionGroupId: matGroup.id,
        label: "1.67 High Index",
        priceDeltaMinor: 3500,
        tokenKey: "lens_material",
        tokenValue: "PO-67",
        shopifyVariantId: "gid://shopify/ProductVariant/67",
      });

      // 2. Tint / Colour group with values and swatch
      const colorGroup = await catalogService.createOptionGroup(shopId, {
        name: "Tint Colours",
        kind: "COLOR",
      });
      await catalogService.createOptionValue(shopId, {
        optionGroupId: colorGroup.id,
        label: "Gradient Grey",
        priceDeltaMinor: 4000,
        swatch: "#555555",
        overrideCode: "TINT_GREY",
        shopifyVariantId: "gid://shopify/ProductVariant/grey",
      });

      // 3. Add-on
      await catalogService.createAddOn(shopId, {
        name: "Premium Hard Case",
        priceMinor: 2500,
        shopifyVariantId: "gid://shopify/ProductVariant/case",
      });

      const request = new Request("https://shop-populated.myshopify.com/app/options");
      const loaderRes = await indexLoader(createLoaderArgs(request));
      const { data: loaderData } = await unwrapResponse<{
        groups: Array<{ name: string; values: Array<{ label: string }> }>;
        addOns: Array<{ name: string }>;
        plan: { active: boolean };
        shopDomain: string;
      }>(loaderRes);

      expect(loaderData.groups.length).toBe(2);
      expect(loaderData.addOns.length).toBe(1);

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(loaderData);
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container } = render(
        <AdminOptionsIndexRoute />
      );

      // Verify sections and items
      expect(container.querySelector('s-section[heading="Material & index"]')).not.toBeNull();
      expect(container.querySelector('s-section[heading="Tint & colour"]')).not.toBeNull();
      expect(container.querySelector('s-section[heading="Add-ons"]')).not.toBeNull();

      expect(screen.getByText("Standard Materials")).toBeTruthy();
      expect(screen.getByText("1.50 Standard")).toBeTruthy();
      expect(screen.getAllByText("Included").length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText("1.67 High Index")).toBeTruthy();
      expect(screen.getByText("+$35.00")).toBeTruthy();
      expect(screen.getByText("Token: lens_material=PO-67")).toBeTruthy();

      expect(screen.getByText("Tint Colours (Colour)")).toBeTruthy();
      expect(screen.getByText("Gradient Grey")).toBeTruthy();
      expect(screen.getByText("+$40.00")).toBeTruthy();
      expect(screen.getByText("Override: TINT_GREY")).toBeTruthy();
      expect(screen.getByText("Swatch: #555555")).toBeTruthy();

      expect(screen.getByText("Premium Hard Case")).toBeTruthy();
      expect(screen.getByText("$25.00")).toBeTruthy();
    });
  });

  describe("UI Component: OptionValueForm", () => {
    it("renders label, price delta, code choices, and hides swatch for MATERIAL group", () => {
      const { container } = render(
        <OptionValueForm
          initialData={{ label: "Polycarbonate", priceDelta: "20.00" }}
          groupKind="MATERIAL"
        />,
      );

      expect(container.querySelector('s-text-field[name="label"]')).not.toBeNull();
      expect(container.querySelector('s-text-field[name="priceDelta"]')).not.toBeNull();
      expect(container.querySelector('s-choice-list[name="codeType"]')).not.toBeNull();
      expect(screen.getByText("Save option value")).toBeTruthy();
      expect(container.querySelector('s-text-field[name="swatch"]')).toBeNull();
    });

    it("renders swatch colour field when groupKind is COLOR", () => {
      const { container } = render(
        <OptionValueForm
          initialData={{ label: "Emerald Green", swatch: "#006400" }}
          groupKind="COLOR"
        />,
      );

      expect(container.querySelector('s-text-field[name="swatch"]')).not.toBeNull();
    });

    it("displays inline banners for ONE_CODE_SOURCE, MONEY_PRECISION, and NEGATIVE_PRICE errors", () => {
      const { container } = render(
        <OptionValueForm
          errors={{
            ONE_CODE_SOURCE: "Choose either a lab-code token or an override code, not both.",
            MONEY_PRECISION: "Maximum 2 decimal places allowed for USD.",
            NEGATIVE_PRICE: "Price delta must be at least 0.",
          }}
          groupKind="MATERIAL"
        />,
      );

      expect(
        container.querySelector('s-banner[heading="Code source conflict"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('s-banner[heading="Invalid price precision"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('s-banner[heading="Invalid price delta"]'),
      ).not.toBeNull();
    });
  });

  describe("Add-ons Route (`app.add-ons.$id.tsx`)", () => {
    it("creates, syncs, updates, and archives an add-on", async () => {
      const shopId = await createShop("shop-addon.myshopify.com");
      mocks.currentShop = "shop-addon.myshopify.com";

      // 1. Create
      const createReq = new Request("https://test-shop.myshopify.com/app/add-ons/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Blue Light Filter",
          price: "15.00",
        }),
      });

      const createRes = await addOnAction(
        createActionArgs(createReq, { id: "new" }),
      );
      const created = await unwrapResponse<{
        ok: boolean;
        addOn: { id: string; name: string; price: { amountMinor: number } };
      }>(createRes);

      expect(created.status).toBe(200);
      expect(created.data.ok).toBe(true);
      expect(created.data.addOn.name).toBe("Blue Light Filter");
      expect(created.data.addOn.price.amountMinor).toBe(1500);

      // Verify syncItem was triggered
      expect(
        recordedCalls.some((c) => c.query.includes("ProductCreate")),
      ).toBe(true);

      // 2. Update
      const updateReq = new Request(
        `https://test-shop.myshopify.com/app/add-ons/${created.data.addOn.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Blue Light Filter Pro",
            price: "25.00",
          }),
        },
      );

      const updateRes = await addOnAction(
        createActionArgs(updateReq, { id: created.data.addOn.id }),
      );
      const updated = await unwrapResponse<{
        ok: boolean;
        addOn: { name: string; price: { amountMinor: number } };
      }>(updateRes);

      expect(updated.status).toBe(200);
      expect(updated.data.addOn.name).toBe("Blue Light Filter Pro");
      expect(updated.data.addOn.price.amountMinor).toBe(2500);

      // 3. Archive
      const archiveReq = new Request(
        `https://test-shop.myshopify.com/app/add-ons/${created.data.addOn.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "archive",
          }),
        },
      );

      const archiveRes = await addOnAction(
        createActionArgs(archiveReq, { id: created.data.addOn.id }),
      );
      const archived = await unwrapResponse<{ ok: boolean; archived: boolean }>(
        archiveRes,
      );
      expect(archived.status).toBe(200);
      expect(archived.data.archived).toBe(true);

      // Verify soft delete: getAddOn still has archivedAt set, listAddOns excludes it
      const inDb = await catalogService.getAddOn(
        shopId,
        created.data.addOn.id,
      );
      expect(inDb.archivedAt).not.toBeNull();

      const activeList = await catalogService.listAddOns(shopId);
      expect(activeList.find((a) => a.id === created.data.addOn.id)).toBeUndefined();
    });
  });

  describe("Main Index Actions", () => {
    it("creates an option group via indexAction intent: create_group", async () => {
      const _shopId = await createShop("shop-index-actions.myshopify.com");
      mocks.currentShop = "shop-index-actions.myshopify.com";

      const req = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "create_group",
          name: "Transition Types",
          kind: "TINT_TYPE",
        }),
      });

      const res = await indexAction(createActionArgs(req));
      const unwrapped = await unwrapResponse<{
        ok: boolean;
        group: { id: string; name: string; kind: string };
      }>(res);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.group.name).toBe("Transition Types");
      expect(unwrapped.data.group.kind).toBe("TINT_TYPE");
    });
  });

  describe("Option Value & Add-on Routes Component and Loader", () => {
    it("loads and renders OptionValueRoute for editing", async () => {
      const shopId = await createShop("shop-optval-ui.myshopify.com");
      mocks.currentShop = "shop-optval-ui.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Index Options",
        kind: "MATERIAL",
      });
      const optVal = await catalogService.createOptionValue(shopId, {
        optionGroupId: group.id,
        label: "1.74 Ultra Thin",
        priceDeltaMinor: 6000,
      });

      const req = new Request(`https://test-shop.myshopify.com/app/options/${optVal.id}`);
      const loaderRes = await optionValueLoader(createLoaderArgs(req, { id: optVal.id }));
      const { data: loaderData } = await unwrapResponse<{
        optionValue: { label: string };
        group: { kind: string };
      }>(loaderRes);

      expect(loaderData.optionValue.label).toBe("1.74 Ultra Thin");

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(loaderData);
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      expect(container.querySelector('s-page[heading="Edit: 1.74 Ultra Thin"]')).not.toBeNull();
    });

    it("loads and renders AddOnRoute for editing", async () => {
      const shopId = await createShop("shop-addon-ui.myshopify.com");
      mocks.currentShop = "shop-addon-ui.myshopify.com";

      const addOn = await catalogService.createAddOn(shopId, {
        name: "Lens Cleaner Kit",
        priceMinor: 999,
      });

      const req = new Request(`https://test-shop.myshopify.com/app/add-ons/${addOn.id}`);
      const loaderRes = await addOnLoader(createLoaderArgs(req, { id: addOn.id }));
      const { data: loaderData } = await unwrapResponse<{
        addOn: { name: string; price: { amountMinor: number } };
      }>(loaderRes);

      expect(loaderData.addOn.name).toBe("Lens Cleaner Kit");

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(loaderData);
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <AddOnRoute />
        </ReactRouter.MemoryRouter>,
      );

      expect(container.querySelector('s-page[heading="Edit: Lens Cleaner Kit"]')).not.toBeNull();
    });
  });
});
