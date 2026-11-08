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
import { render, screen, cleanup, within } from "@testing-library/react";
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
  formatMoneyDisplay,
  loader as indexLoader,
  ErrorBoundary as IndexErrorBoundary,
} from "../../routes/app.options._index";
import OptionValueRoute, {
  action as optionValueAction,
  loader as optionValueLoader,
  ErrorBoundary as OptionValueErrorBoundary,
} from "../../routes/app.options.$id";
import AddOnRoute, {
  action as addOnAction,
  loader as addOnLoader,
  ErrorBoundary as AddOnErrorBoundary,
} from "../../routes/app.add-ons.$id";
import { toShopifyDecimal } from "../../../packages/rx-core/src/pricing/index.js";
import { fireEvent } from "@testing-library/react";

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

const origCreateElement = document.createElement.bind(document);

beforeAll(async () => {
  document.createElement = function (tagName: string, options?: ElementCreationOptions) {
    const el = origCreateElement(tagName, options);
    if (tagName.toLowerCase() === "s-button") {
      el.setAttribute("role", "button");
    }
    return el;
  };

  db = await createTestDb();
  (globalThis as Record<string, unknown>).__prismaClient = db.prisma;
  catalogService = createCatalogService({ prisma: db.prisma });
}, DB_TIMEOUT_MS);

afterAll(async () => {
  document.createElement = origCreateElement;
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
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
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

      // Verify route-to-form error wiring renders the inline error on the field
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        optionValue: null,
        group,
        allGroups: [group],
        plan: { active: true },
        shopDomain: mocks.currentShop,
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(unwrapped.data);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      const priceField = container.querySelector('s-text-field[name="priceDelta"]');
      expect(priceField).not.toBeNull();
      expect(priceField?.getAttribute("error")).toBe("Maximum 2 decimal places allowed for USD");
      expect(screen.getByText(/Maximum 2 decimal places allowed for USD/)).toBeTruthy();
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

      // Verify route-to-form error wiring renders the inline error on the field
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        optionValue: null,
        group,
        allGroups: [group],
        plan: { active: true },
        shopDomain: mocks.currentShop,
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(unwrapped.data);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      const priceField = container.querySelector('s-text-field[name="priceDelta"]');
      expect(priceField).not.toBeNull();
      expect(priceField?.getAttribute("error")).toBe("Price delta must be at least 0");
      expect(screen.getByText(/Price delta must be at least 0/)).toBeTruthy();
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

      // Verify route-to-form error wiring renders the inline error on the field
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        optionValue: null,
        group,
        allGroups: [group],
        plan: { active: true },
        shopDomain: mocks.currentShop,
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(unwrapped.data);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      const overrideField = container.querySelector('s-text-field[name="overrideCode"]');
      expect(overrideField).not.toBeNull();
      expect(overrideField?.getAttribute("error")).toBe(
        "Choose either a lab-code token or an override code, not both",
      );
      expect(
        screen.getByText(/Choose either a lab-code token or an override code, not both/),
      ).toBeTruthy();
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

  describe("Accepted Findings Verification Tests (R1)", () => {
    it("R1-F1: opens Add option group modal overlay via showOverlay() on click", () => {
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        groups: [],
        addOns: [],
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );

      const modal = container.querySelector("#add-option-group-modal") as HTMLElement & {
        showOverlay?: ReturnType<typeof vi.fn>;
        hideOverlay?: ReturnType<typeof vi.fn>;
      };
      expect(modal).not.toBeNull();
      const showSpy = vi.fn();
      const hideSpy = vi.fn();
      modal.showOverlay = showSpy;
      modal.hideOverlay = hideSpy;

      const addBtn = screen.getByRole("button", { name: "Add option group" });
      fireEvent.click(addBtn);

      expect(showSpy).toHaveBeenCalledTimes(1);

      const cancelBtn = within(modal).getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);
      expect(hideSpy).toHaveBeenCalledTimes(1);
    });

    it("R1-F2: round-trips JPY (0) and KWD (3) through toShopifyDecimal and parseMoneyText without dividing by 100", () => {
      // JPY: 1500 minor units
      const jpyDecimal = toShopifyDecimal(1500, "JPY");
      expect(jpyDecimal).toBe("1500");
      const jpyParsed = parseMoneyText(jpyDecimal, "JPY");
      expect(jpyParsed.ok).toBe(true);
      if (jpyParsed.ok) {
        expect(jpyParsed.amountMinor).toBe(1500);
      }

      // KWD: 1500 minor units
      const kwdDecimal = toShopifyDecimal(1500, "KWD");
      expect(kwdDecimal).toBe("1.500");
      const kwdParsed = parseMoneyText(kwdDecimal, "KWD");
      expect(kwdParsed.ok).toBe(true);
      if (kwdParsed.ok) {
        expect(kwdParsed.amountMinor).toBe(1500);
      }

      // formatMoneyDisplay formatting
      expect(formatMoneyDisplay(1500, "JPY")).toContain("1,500");
      expect(formatMoneyDisplay(1500, "KWD")).toContain("1.500");
    });

    it("R1-F2: renders JPY and KWD initial values in OptionValueRoute and AddOnRoute without dividing by 100", () => {
      // OptionValueRoute with JPY
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        optionValue: {
          id: "val-jpy",
          optionGroupId: "grp-1",
          label: "JPY Option",
          priceDelta: { amountMinor: 1500, currency: "JPY" },
        },
        group: { id: "grp-1", kind: "MATERIAL" },
        allGroups: [],
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container: optContainer } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );
      const priceField = optContainer.querySelector('s-text-field[name="priceDelta"]');
      expect(priceField?.getAttribute("value")).toBe("1500");

      cleanup();

      // AddOnRoute with KWD
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        addOn: {
          id: "addon-kwd",
          name: "KWD AddOn",
          price: { amountMinor: 1500, currency: "KWD" },
        },
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container: addOnContainer } = render(
        <ReactRouter.MemoryRouter>
          <AddOnRoute />
        </ReactRouter.MemoryRouter>,
      );
      const addOnPrice = addOnContainer.querySelector('s-text-field[name="price"]');
      expect(addOnPrice?.getAttribute("value")).toBe("1.500");
    });

    it("R1-F3: retains variant ID on archiveItem failure during price removal (save stays)", async () => {
      const shopId = await createShop("shop-archive-fail.myshopify.com");
      mocks.currentShop = "shop-archive-fail.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      const initial = await catalogService.createOptionValue(shopId, {
        optionGroupId: group.id,
        label: "Anti-reflective",
        priceDeltaMinor: 1500,
        shopifyVariantId: "gid://shopify/ProductVariant/777",
      });

      // Mock ProductUpdate to fail and GetVariantProduct to return product ID
      mocks.adminGraphql.mockImplementation(async (query: string, init?: { variables?: Record<string, unknown> }) => {
        if (query.includes("ProductUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                productUpdate: {
                  product: null,
                  userErrors: [{ message: "Shopify API network timeout" }],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (query.includes("GetVariantProduct")) {
          return new Response(
            JSON.stringify({
              data: {
                productVariant: {
                  id: (init?.variables?.id as string) ?? "gid://shopify/ProductVariant/777",
                  product: { id: "gid://shopify/Product/existing-product" },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      const req = new Request(`https://test-shop.myshopify.com/app/options/${initial.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "Anti-reflective",
          priceDelta: "0",
        }),
      });

      const res = await optionValueAction(createActionArgs(req, { id: initial.id }));
      const unwrapped = await unwrapResponse<{
        ok: boolean;
        syncFailed: boolean;
        optionValue: { priceDelta: { amountMinor: number }; shopifyVariantId: string | null };
      }>(res);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.syncFailed).toBe(true);
      // The variant id must NOT be cleared when archive fails
      expect(unwrapped.data.optionValue.shopifyVariantId).toBe("gid://shopify/ProductVariant/777");

      // Verify DB row still retains the variant ID and updated price
      const saved = await catalogService.getOptionValue(shopId, initial.id);
      expect(saved?.shopifyVariantId).toBe("gid://shopify/ProductVariant/777");
      expect(saved?.priceDelta.amountMinor).toBe(0);
    });

    it("R1-F3: returns 400 SHOPIFY_ARCHIVE_FAILED and does not delete add-on when Shopify archive fails", async () => {
      const shopId = await createShop("shop-addon-del-fail.myshopify.com");
      mocks.currentShop = "shop-addon-del-fail.myshopify.com";

      const addOn = await catalogService.createAddOn(shopId, {
        name: "Test AddOn",
        priceMinor: 1000,
      });
      await catalogService.updateAddOn(shopId, addOn.id, {
        shopifyVariantId: "gid://shopify/ProductVariant/999",
      });

      // Fail Shopify ProductUpdate
      mocks.adminGraphql.mockImplementation(async (query: string, init?: { variables?: Record<string, unknown> }) => {
        if (query.includes("ProductUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                productUpdate: {
                  product: null,
                  userErrors: [{ message: "Archive failed" }],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (query.includes("GetVariantProduct")) {
          return new Response(
            JSON.stringify({
              data: {
                productVariant: {
                  id: (init?.variables?.id as string) ?? "gid://shopify/ProductVariant/999",
                  product: { id: "gid://shopify/Product/existing-product" },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      const req = new Request(`https://test-shop.myshopify.com/app/add-ons/${addOn.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "delete" }),
      });

      const res = await addOnAction(createActionArgs(req, { id: addOn.id }));
      const unwrapped = await unwrapResponse<{ error: { code: string } }>(res);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("SHOPIFY_ARCHIVE_FAILED");

      // Verify add-on still active in DB
      const inDb = await catalogService.getAddOn(shopId, addOn.id);
      expect(inDb.archivedAt).toBeNull();
    });

    it("R1-F4: boundary validation returns 400 for null, malformed payload, and hostile types", async () => {
      const _shopId = await createShop("shop-boundary-val.myshopify.com");
      mocks.currentShop = "shop-boundary-val.myshopify.com";

      // 1. JSON null payload to index action
      const nullReq = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      const nullRes = await indexAction(createActionArgs(nullReq));
      const nullUnwrapped = await unwrapResponse<{ error: { code: string } }>(nullRes);
      expect(nullUnwrapped.status).toBe(400);
      expect(nullUnwrapped.data.error.code).toBe("INVALID_INPUT");

      // 2. Malformed create_group (missing name)
      const badCreateGroup = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "create_group", name: "   ", kind: "MATERIAL" }),
      });
      const badCreateRes = await indexAction(createActionArgs(badCreateGroup));
      const badCreateUnwrapped = await unwrapResponse<{ error: { code: string } }>(badCreateRes);
      expect(badCreateUnwrapped.status).toBe(400);
      expect(badCreateUnwrapped.data.error.code).toBe("REQUIRED");

      // 3. Malformed delete_group (missing groupId)
      const badDelGroup = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "delete_group" }),
      });
      const badDelRes = await indexAction(createActionArgs(badDelGroup));
      const badDelUnwrapped = await unwrapResponse<{ error: { code: string } }>(badDelRes);
      expect(badDelUnwrapped.status).toBe(400);

      // 4. Malformed reorder_groups (invalid JSON / non-array)
      const badReorder = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "reorder_groups", ids: "invalid json string" }),
      });
      const badReorderRes = await indexAction(createActionArgs(badReorder));
      const badReorderUnwrapped = await unwrapResponse<{ error: { code: string } }>(badReorderRes);
      expect(badReorderUnwrapped.status).toBe(400);

      // 5. Hostile type in option value: priceDeltaMinor: true (boolean coerced check)
      const hostileOpt = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: "some-group",
          label: "Test Label",
          priceDeltaMinor: true,
        }),
      });
      const hostileOptRes = await optionValueAction(createActionArgs(hostileOpt, { id: "new" }));
      const hostileOptUnwrapped = await unwrapResponse<{ error: { code: string } }>(hostileOptRes);
      expect(hostileOptUnwrapped.status).toBe(400);
      expect(hostileOptUnwrapped.data.error.code).toBe("NOT_INTEGER");

      // 6. Hostile type in add-on: priceMinor: true
      const hostileAddOn = new Request("https://test-shop.myshopify.com/app/add-ons/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Addon",
          priceMinor: true,
        }),
      });
      const hostileAddOnRes = await addOnAction(createActionArgs(hostileAddOn, { id: "new" }));
      const hostileAddOnUnwrapped = await unwrapResponse<{ error: { code: string } }>(hostileAddOnRes);
      expect(hostileAddOnUnwrapped.status).toBe(400);
      expect(hostileAddOnUnwrapped.data.error.code).toBe("NOT_INTEGER");

      // 7. Unknown intent in index action
      const unknownIntent = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "unknown_intent" }),
      });
      const unknownRes = await indexAction(createActionArgs(unknownIntent));
      const unknownUnwrapped = await unwrapResponse<{ error: { code: string } }>(unknownRes);
      expect(unknownUnwrapped.status).toBe(400);
    });

    it("R1-F6: disables Save and shows loading during submission across option and add-on forms", () => {
      // Mock navigation state as submitting
      vi.spyOn(ReactRouter, "useNavigation").mockReturnValue({
        state: "submitting",
        location: { pathname: "/app/options/new", search: "", hash: "", state: null, key: "1" },
        formMethod: "POST",
        formAction: "/app/options/new",
        formEncType: "application/x-www-form-urlencoded",
        formData: new FormData(),
        json: undefined,
        text: undefined,
      });
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        optionValue: null,
        group: { id: "g1", kind: "MATERIAL" },
        allGroups: [],
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      const saveBtn = container.querySelector('s-button[type="submit"]');
      expect(saveBtn).not.toBeNull();
      expect(saveBtn?.getAttribute("disabled")).toBeTruthy();
      expect(saveBtn?.getAttribute("loading")).toBeTruthy();

      cleanup();

      // AddOnRoute loading check
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        addOn: null,
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });
      const { container: addOnContainer } = render(
        <ReactRouter.MemoryRouter>
          <AddOnRoute />
        </ReactRouter.MemoryRouter>,
      );
      const addOnSave = addOnContainer.querySelector('s-button[type="submit"]');
      expect(addOnSave).not.toBeNull();
      expect(addOnSave?.getAttribute("disabled")).toBeTruthy();
      expect(addOnSave?.getAttribute("loading")).toBeTruthy();
    });

    it("R1-F7: error boundaries pass thrown route error via useRouteError()", () => {
      // 1. ErrorResponse renders HTML in boundary
      const errorResponse = {
        constructor: { name: "ErrorResponseImpl" },
        status: 500,
        data: "Loader execution failed",
      };
      vi.spyOn(ReactRouter, "useRouteError").mockReturnValue(errorResponse);

      const { container: indexErrContainer } = render(
        <IndexErrorBoundary />,
      );
      expect(indexErrContainer.innerHTML).toContain("Loader execution failed");

      cleanup();

      const { container: optErrContainer } = render(
        <OptionValueErrorBoundary />,
      );
      expect(optErrContainer.innerHTML).toContain("Loader execution failed");

      cleanup();

      const { container: addOnErrContainer } = render(
        <AddOnErrorBoundary />,
      );
      expect(addOnErrContainer.innerHTML).toContain("Loader execution failed");

      cleanup();

      // 2. Standard Error rethrows through boundary.error
      const standardError = new Error("Action DB crash");
      vi.spyOn(ReactRouter, "useRouteError").mockReturnValue(standardError);
      expect(() => render(<IndexErrorBoundary />)).toThrow("Action DB crash");
      expect(() => render(<OptionValueErrorBoundary />)).toThrow("Action DB crash");
      expect(() => render(<AddOnErrorBoundary />)).toThrow("Action DB crash");
    });

    it("R1-F8: exposes controls for move up/down, delete with confirm modal, and Retry on Sync failed badge", () => {
      const mockGroups = [
        {
          id: "g1",
          name: "Material 1",
          kind: "MATERIAL" as const,
          position: 0,
          values: [
            {
              id: "v1",
              optionGroupId: "g1",
              label: "1.50 Standard",
              priceDelta: { amountMinor: 0, currency: "USD" },
              shopifyVariantId: "gid://shopify/ProductVariant/failed-archive",
              position: 0,
            },
            {
              id: "v2",
              optionGroupId: "g1",
              label: "1.67 High Index",
              priceDelta: { amountMinor: 3500, currency: "USD" },
              shopifyVariantId: null, // failed sync
              position: 1,
            },
          ],
        },
        {
          id: "g2",
          name: "Material 2",
          kind: "MATERIAL" as const,
          position: 1,
          values: [],
        },
      ];

      const mockAddOns = [
        {
          id: "a1",
          name: "AddOn 1",
          price: { amountMinor: 1000, currency: "USD" },
          shopifyVariantId: null, // sync failed
          position: 0,
        },
        {
          id: "a2",
          name: "AddOn 2",
          price: { amountMinor: 2000, currency: "USD" },
          shopifyVariantId: "gid://shopify/ProductVariant/synced",
          position: 1,
        },
      ];

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        groups: mockGroups,
        addOns: mockAddOns,
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });

      const { container } = render(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );

      // 1. Move up / Move down buttons exist for groups, values, and add-ons
      const moveUpButtons = screen.getAllByRole("button", { name: "Move up" });
      const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
      expect(moveUpButtons.length).toBeGreaterThanOrEqual(3);
      expect(moveDownButtons.length).toBeGreaterThanOrEqual(3);

      // First group Move up should be disabled
      expect(moveUpButtons[0].getAttribute("disabled")).toBeTruthy();
      // Second group Move down should be disabled
      expect(moveDownButtons[1].getAttribute("disabled")).toBeTruthy();

      // 2. Retry button exists next to Sync failed badges
      const retryButtons = screen.getAllByRole("button", { name: "Retry" });
      expect(retryButtons.length).toBe(3); // v1 (archive failed), v2 (sync failed), a1 (sync failed)

      // 3. Delete group button opens delete confirm modal
      const deleteModal = container.querySelector("#delete-confirm-modal") as HTMLElement & {
        showOverlay?: ReturnType<typeof vi.fn>;
        hideOverlay?: ReturnType<typeof vi.fn>;
      };
      expect(deleteModal).not.toBeNull();
      const showDeleteSpy = vi.fn();
      const hideDeleteSpy = vi.fn();
      deleteModal.showOverlay = showDeleteSpy;
      deleteModal.hideOverlay = hideDeleteSpy;

      const deleteGroupButtons = screen.getAllByRole("button", { name: "Delete group" });
      expect(deleteGroupButtons.length).toBe(2);
      fireEvent.click(deleteGroupButtons[0]);
      expect(showDeleteSpy).toHaveBeenCalledTimes(1);

      // Confirm delete button inside the modal
      const confirmDeleteBtn = screen.getByRole("button", { name: "Confirm delete" });
      expect(confirmDeleteBtn).not.toBeNull();

      // Cancel delete
      const cancelDeleteBtn = within(deleteModal).getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelDeleteBtn);
      expect(hideDeleteSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Accepted Findings Verification Tests (R2)", () => {
    it("R2-F1: option-value and add-on routes reject unknown intents with 400 UNKNOWN_INTENT and leave data unchanged", async () => {
      const shopId = await createShop("shop-r2f1.myshopify.com");
      mocks.currentShop = "shop-r2f1.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      const createdOpt = await catalogService.createOptionValue(shopId, {
        optionGroupId: group.id,
        label: "Polycarbonate",
        priceDeltaMinor: 2500,
        currency: "USD",
        tokenKey: "material",
        tokenValue: "POLY",
        swatch: "#ffffff",
      });

      const createdAddOn = await catalogService.createAddOn(shopId, {
        name: "Anti-reflective",
        priceMinor: 1500,
        currency: "USD",
      });

      // 1. Post unknown intent to option value route
      const hostileOptReq = new Request(
        `https://test-shop.myshopify.com/app/options/${createdOpt.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "unknown_intent",
            label: "MUTATED_LABEL",
            priceDelta: "99.99",
          }),
        },
      );
      const hostileOptRes = await optionValueAction(
        createActionArgs(hostileOptReq, { id: createdOpt.id }),
      );
      const hostileOptUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(hostileOptRes);

      expect(hostileOptUnwrapped.status).toBe(400);
      expect(hostileOptUnwrapped.data.error.code).toBe("UNKNOWN_INTENT");

      // Verify existing option value in DB is completely unchanged
      const currentOpt = await catalogService.getOptionValue(shopId, createdOpt.id);
      expect(currentOpt).not.toBeNull();
      expect(currentOpt!.label).toBe("Polycarbonate");
      expect(currentOpt!.priceDelta.amountMinor).toBe(2500);
      expect(currentOpt!.tokenKey).toBe("material");
      expect(currentOpt!.tokenValue).toBe("POLY");
      expect(currentOpt!.swatch).toBe("#ffffff");

      // 2. Post unknown intent to add-on route
      const hostileAddOnReq = new Request(
        `https://test-shop.myshopify.com/app/add-ons/${createdAddOn.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "unknown_intent",
            name: "MUTATED_ADDON",
            price: "99.99",
          }),
        },
      );
      const hostileAddOnRes = await addOnAction(
        createActionArgs(hostileAddOnReq, { id: createdAddOn.id }),
      );
      const hostileAddOnUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(hostileAddOnRes);

      expect(hostileAddOnUnwrapped.status).toBe(400);
      expect(hostileAddOnUnwrapped.data.error.code).toBe("UNKNOWN_INTENT");

      // Verify existing add-on in DB is completely unchanged
      const currentAddOn = await catalogService.getAddOn(shopId, createdAddOn.id);
      expect(currentAddOn).not.toBeNull();
      expect(currentAddOn!.name).toBe("Anti-reflective");
      expect(currentAddOn!.price.amountMinor).toBe(1500);

      // 3. Normal save without intent succeeds
      const validOptReq = new Request(
        `https://test-shop.myshopify.com/app/options/${createdOpt.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Polycarbonate High Grade",
          }),
        },
      );
      const validOptRes = await optionValueAction(
        createActionArgs(validOptReq, { id: createdOpt.id }),
      );
      const validOptUnwrapped = await unwrapResponse<{ ok: boolean }>(validOptRes);
      expect(validOptUnwrapped.status).toBe(200);
      expect(validOptUnwrapped.data.ok).toBe(true);

      const updatedOpt = await catalogService.getOptionValue(shopId, createdOpt.id);
      expect(updatedOpt!.label).toBe("Polycarbonate High Grade");
    });

    it("R2-F2: lab-code tokens must be key=VALUE with both parts non-empty; rejects malformed with inline error", async () => {
      const shopId = await createShop("shop-r2f2.myshopify.com");
      mocks.currentShop = "shop-r2f2.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });

      // 1. Missing '=': 'foo'
      const reqMissingEq = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Test 1",
          token: "foo",
        }),
      });
      const resMissingEq = await optionValueAction(createActionArgs(reqMissingEq, { id: "new" }));
      const unwrappedMissingEq = await unwrapResponse<{
        error: { code: string; message: string; fields?: Array<{ path: string; code: string }> };
      }>(resMissingEq);
      expect(unwrappedMissingEq.status).toBe(400);
      expect(unwrappedMissingEq.data.error.code).toBe("MALFORMED_TOKEN");
      expect(unwrappedMissingEq.data.error.fields).toEqual([
        { path: "token", code: "MALFORMED_TOKEN" },
      ]);

      // 2. Missing key: '=BAR'
      const reqMissingKey = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Test 2",
          token: "=BAR",
        }),
      });
      const resMissingKey = await optionValueAction(createActionArgs(reqMissingKey, { id: "new" }));
      const unwrappedMissingKey = await unwrapResponse<{
        error: { code: string; message: string };
      }>(resMissingKey);
      expect(unwrappedMissingKey.status).toBe(400);
      expect(unwrappedMissingKey.data.error.code).toBe("MALFORMED_TOKEN");

      // 3. Missing value: 'foo='
      const reqMissingVal = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Test 3",
          token: "foo=",
        }),
      });
      const resMissingVal = await optionValueAction(createActionArgs(reqMissingVal, { id: "new" }));
      const unwrappedMissingVal = await unwrapResponse<{
        error: { code: string; message: string };
      }>(resMissingVal);
      expect(unwrappedMissingVal.status).toBe(400);
      expect(unwrappedMissingVal.data.error.code).toBe("MALFORMED_TOKEN");

      // 4. Empty key and value: ' = '
      const reqEmptyBoth = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Test 4",
          token: " = ",
        }),
      });
      const resEmptyBoth = await optionValueAction(createActionArgs(reqEmptyBoth, { id: "new" }));
      const unwrappedEmptyBoth = await unwrapResponse<{
        error: { code: string; message: string };
      }>(resEmptyBoth);
      expect(unwrappedEmptyBoth.status).toBe(400);
      expect(unwrappedEmptyBoth.data.error.code).toBe("MALFORMED_TOKEN");

      // 5. Render form with MALFORMED_TOKEN error: verifies inline field error
      const { container } = render(
        <OptionValueForm
          groupKind="MATERIAL"
          initialData={{
            label: "Test 1",
            token: "foo",
            codeType: "token",
          }}
          errors={{
            MALFORMED_TOKEN: "Lab-code token must be in key=VALUE format",
            token: "Lab-code token must be in key=VALUE format",
          }}
        />,
      );
      const tokenField = container.querySelector('s-text-field[name="token"]');
      expect(tokenField).not.toBeNull();
      expect(tokenField?.getAttribute("error")).toBe("Lab-code token must be in key=VALUE format");

      // 6. ONE_CODE_SOURCE is preserved when both token and overrideCode are passed
      const reqBoth = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Test 5",
          token: "lens_material=PO-67",
          overrideCode: "OVERRIDE-1",
        }),
      });
      const resBoth = await optionValueAction(createActionArgs(reqBoth, { id: "new" }));
      const unwrappedBoth = await unwrapResponse<{
        error: { code: string; message: string };
      }>(resBoth);
      expect(unwrappedBoth.status).toBe(400);
      expect(unwrappedBoth.data.error.code).toBe("ONE_CODE_SOURCE");
    });

    it("R2-F3: index action failures (delete, retry, reorder) render error banner to merchant", () => {
      // 1. Shopify archive failure on delete renders error banner
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        groups: [],
        addOns: [],
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue({
        error: {
          code: "SHOPIFY_ARCHIVE_FAILED",
          message: "Failed to archive item in Shopify. Please retry.",
        },
      });

      const { rerender } = render(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );

      expect(screen.getByText("Failed to archive item in Shopify. Please retry.")).toBeTruthy();

      // 2. Sync failure on retry renders error banner
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue({
        error: {
          code: "SYNC_FAILED",
          message: "Shopify archive failed on retry",
        },
      });
      rerender(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );
      expect(screen.getByText("Shopify archive failed on retry")).toBeTruthy();

      // 3. Generic action failure (e.g. duplicate group name)
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue({
        error: {
          code: "NAME_NOT_UNIQUE",
          message: "An option group with this name already exists",
        },
      });
      rerender(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );
      expect(screen.getByText("An option group with this name already exists")).toBeTruthy();
    });

    it("R2-F4: unlisted service errors (e.g. NAME_NOT_UNIQUE) render fallback form-level error banner in detail forms", async () => {
      const shopId = await createShop("shop-r2f4.myshopify.com");
      mocks.currentShop = "shop-r2f4.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material",
        kind: "MATERIAL",
      });
      await catalogService.createOptionValue(shopId, {
        optionGroupId: group.id,
        label: "Existing Option Value",
        priceDeltaMinor: 0,
      });

      // 1. Duplicate Option Value submission returns NAME_NOT_UNIQUE
      const dupOptReq = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "Existing Option Value",
          priceDelta: "0",
        }),
      });
      const dupOptRes = await optionValueAction(createActionArgs(dupOptReq, { id: "new" }));
      const dupOptUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(dupOptRes);
      expect(dupOptUnwrapped.status).toBe(400);
      expect(dupOptUnwrapped.data.error.code).toBe("NAME_NOT_UNIQUE");

      // Render OptionValueRoute with this actionData error
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(dupOptUnwrapped.data);
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        group,
        allGroups: [group],
        optionValue: null,
        currency: "USD",
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });

      const { rerender } = render(
        <ReactRouter.MemoryRouter>
          <OptionValueRoute />
        </ReactRouter.MemoryRouter>,
      );

      // Fallback banner displays duplicate label message
      expect(
        screen.getByText("An option value with this label already exists in this group"),
      ).toBeTruthy();

      // 2. Duplicate Add-on submission returns NAME_NOT_UNIQUE
      await catalogService.createAddOn(shopId, {
        name: "Existing Add-on",
        priceMinor: 1000,
        currency: "USD",
      });

      const dupAddOnReq = new Request("https://test-shop.myshopify.com/app/add-ons/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Existing Add-on",
          price: "10.00",
        }),
      });
      const dupAddOnRes = await addOnAction(createActionArgs(dupAddOnReq, { id: "new" }));
      const dupAddOnUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(dupAddOnRes);
      expect(dupAddOnUnwrapped.status).toBe(400);
      expect(dupAddOnUnwrapped.data.error.code).toBe("NAME_NOT_UNIQUE");

      // Render AddOnRoute with this actionData error
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(dupAddOnUnwrapped.data);
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        addOn: null,
        currency: "USD",
        plan: { active: true },
        shopDomain: "test.myshopify.com",
      });

      rerender(
        <ReactRouter.MemoryRouter>
          <AddOnRoute />
        </ReactRouter.MemoryRouter>,
      );

      expect(screen.getByText("An add-on with this name already exists")).toBeTruthy();
    });

    it("R2-F5: money precision error messages are derived from currency minor-unit digits (JPY: 0, KWD: 3)", async () => {
      const shopId = await createShop("shop-r2f5.myshopify.com");
      mocks.currentShop = "shop-r2f5.myshopify.com";

      const group = await catalogService.createOptionGroup(shopId, {
        name: "Material JPY",
        kind: "MATERIAL",
      });

      // 1. Option Value with JPY (digits = 0)
      const jpyOptReq = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "JPY Option",
          priceDelta: "1.1",
          currency: "JPY",
        }),
      });
      const jpyOptRes = await optionValueAction(createActionArgs(jpyOptReq, { id: "new" }));
      const jpyOptUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(jpyOptRes);
      expect(jpyOptUnwrapped.status).toBe(400);
      expect(jpyOptUnwrapped.data.error.code).toBe("MONEY_PRECISION");
      expect(jpyOptUnwrapped.data.error.message).toBe("Maximum 0 decimal places allowed for JPY");

      // 2. Option Value with KWD (digits = 3)
      const kwdOptReq = new Request("https://test-shop.myshopify.com/app/options/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionGroupId: group.id,
          label: "KWD Option",
          priceDelta: "1.1234",
          currency: "KWD",
        }),
      });
      const kwdOptRes = await optionValueAction(createActionArgs(kwdOptReq, { id: "new" }));
      const kwdOptUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(kwdOptRes);
      expect(kwdOptUnwrapped.status).toBe(400);
      expect(kwdOptUnwrapped.data.error.code).toBe("MONEY_PRECISION");
      expect(kwdOptUnwrapped.data.error.message).toBe("Maximum 3 decimal places allowed for KWD");

      // 3. Add-on with JPY (digits = 0)
      const jpyAddOnReq = new Request("https://test-shop.myshopify.com/app/add-ons/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "JPY Add-on",
          price: "1.1",
          currency: "JPY",
        }),
      });
      const jpyAddOnRes = await addOnAction(createActionArgs(jpyAddOnReq, { id: "new" }));
      const jpyAddOnUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(jpyAddOnRes);
      expect(jpyAddOnUnwrapped.status).toBe(400);
      expect(jpyAddOnUnwrapped.data.error.code).toBe("MONEY_PRECISION");
      expect(jpyAddOnUnwrapped.data.error.message).toBe("Maximum 0 decimal places allowed for JPY");

      // 4. Add-on with KWD (digits = 3)
      const kwdAddOnReq = new Request("https://test-shop.myshopify.com/app/add-ons/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "KWD Add-on",
          price: "1.1234",
          currency: "KWD",
        }),
      });
      const kwdAddOnRes = await addOnAction(createActionArgs(kwdAddOnReq, { id: "new" }));
      const kwdAddOnUnwrapped = await unwrapResponse<{
        error: { code: string; message: string };
      }>(kwdAddOnRes);
      expect(kwdAddOnUnwrapped.status).toBe(400);
      expect(kwdAddOnUnwrapped.data.error.code).toBe("MONEY_PRECISION");
      expect(kwdAddOnUnwrapped.data.error.message).toBe("Maximum 3 decimal places allowed for KWD");

      // 5. Test OptionValueForm renders currency-derived guidance in banner
      const { rerender } = render(
        <OptionValueForm
          groupKind="MATERIAL"
          currency="JPY"
          errors={{ MONEY_PRECISION: "MONEY_PRECISION" }}
        />,
      );
      expect(screen.getByText("Maximum 0 decimal places allowed for JPY.")).toBeTruthy();

      rerender(
        <OptionValueForm
          groupKind="MATERIAL"
          currency="KWD"
          errors={{ MONEY_PRECISION: "MONEY_PRECISION" }}
        />,
      );
      expect(screen.getByText("Maximum 3 decimal places allowed for KWD.")).toBeTruthy();
    });

    it("R2-F6: functionally clicks move up/down, retry, and confirmed delete controls by role and verifies payload and UI", async () => {
      const shopId = await createShop("shop-r2f6.myshopify.com");
      mocks.currentShop = "shop-r2f6.myshopify.com";

      // Setup 2 groups with option values and 1 add-on
      const g1 = await catalogService.createOptionGroup(shopId, {
        name: "Material Group A",
        kind: "MATERIAL",
        position: 0,
      });
      const g2 = await catalogService.createOptionGroup(shopId, {
        name: "Material Group B",
        kind: "MATERIAL",
        position: 1,
      });

      const v1 = await catalogService.createOptionValue(shopId, {
        optionGroupId: g1.id,
        label: "Option Value 1",
        priceDeltaMinor: 1000,
        position: 0,
      });
      const _v2 = await catalogService.createOptionValue(shopId, {
        optionGroupId: g1.id,
        label: "Option Value 2",
        priceDeltaMinor: 2000,
        position: 1,
      });

      // Set v1 variant to null so it shows "Sync failed" and has Retry button
      await getTestPrisma().optionValue.update({
        where: { id: v1.id },
        data: { shopifyVariantId: null },
      });

      await catalogService.createAddOn(shopId, {
        name: "Anti-Scratch Coating",
        priceMinor: 500,
        currency: "USD",
      });

      type IndexLoaderResult = {
        groups: Array<{
          id: string;
          name: string;
          kind: "MATERIAL" | "TINT_TYPE" | "COLOR";
          position: number;
          values: Array<{
            id: string;
            label: string;
            priceDelta: { amountMinor: number; currency: string };
            shopifyVariantId: string | null;
            tokenKey?: string;
            tokenValue?: string;
            overrideCode?: string;
            swatch?: string;
          }>;
        }>;
        addOns: Array<{
          id: string;
          name: string;
          price: { amountMinor: number; currency: string };
          shopifyVariantId: string | null;
        }>;
        plan: { active: boolean };
        shopDomain: string;
      };

      // Load data from loader
      const initialLoaderRes = await indexLoader(
        createLoaderArgs(new Request("https://test-shop.myshopify.com/app/options")),
      );
      let loaderData = (await unwrapResponse<IndexLoaderResult>(initialLoaderRes)).data;

      vi.spyOn(ReactRouter, "useLoaderData").mockImplementation(() => loaderData);
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);

      const { container, rerender } = render(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );

      // A. MOVE DOWN ON GROUP: click Move down on Group A by role
      const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
      const groupMoveDownBtn = moveDownButtons[0];
      const groupMoveDownForm = groupMoveDownBtn.closest("form") as HTMLFormElement;
      expect(groupMoveDownForm).not.toBeNull();

      let submittedData: FormData | null = null;
      groupMoveDownForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submittedData = new FormData(groupMoveDownForm);
      });

      fireEvent.click(groupMoveDownBtn);
      expect(submittedData).not.toBeNull();
      expect(submittedData!.get("intent")).toBe("reorder_groups");
      expect(JSON.parse(submittedData!.get("ids") as string)).toEqual([g2.id, g1.id]);

      // Submit to action and verify reorder in action
      const groupReorderReq = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        body: submittedData!,
      });
      const groupReorderRes = await indexAction(createActionArgs(groupReorderReq));
      const groupReorderUnwrapped = await unwrapResponse<{ ok: boolean }>(groupReorderRes);
      expect(groupReorderUnwrapped.status).toBe(200);
      expect(groupReorderUnwrapped.data.ok).toBe(true);

      // Reload data and re-render UI to verify Group B is now first
      const reorderedLoaderRes = await indexLoader(
        createLoaderArgs(new Request("https://test-shop.myshopify.com/app/options")),
      );
      loaderData = (await unwrapResponse<IndexLoaderResult>(reorderedLoaderRes)).data;
      rerender(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );

      const renderedHeadings = Array.from(container.querySelectorAll("s-heading")).map(
        (el) => el.textContent,
      );
      expect(renderedHeadings[0]).toBe("Material Group B");
      expect(renderedHeadings[1]).toBe("Material Group A");

      // B. RETRY SYNC: click Retry on Option Value 1
      const retryButtons = screen.getAllByRole("button", { name: "Retry" });
      expect(retryButtons.length).toBeGreaterThanOrEqual(1);
      const optRetryBtn = retryButtons[0];
      const optRetryForm = optRetryBtn.closest("form") as HTMLFormElement;
      expect(optRetryForm).not.toBeNull();

      let retrySubmittedData: FormData | null = null;
      optRetryForm.addEventListener("submit", (e) => {
        e.preventDefault();
        retrySubmittedData = new FormData(optRetryForm);
      });

      fireEvent.click(optRetryBtn);
      expect(retrySubmittedData).not.toBeNull();
      expect(retrySubmittedData!.get("intent")).toBe("retry_sync");
      expect(retrySubmittedData!.get("entity")).toBe("optionValue");
      expect(retrySubmittedData!.get("id")).toBe(v1.id);

      // Execute action with retry payload
      const retryReq = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        body: retrySubmittedData!,
      });
      const retryRes = await indexAction(createActionArgs(retryReq));
      const retryUnwrapped = await unwrapResponse<{ ok: boolean; synced: boolean }>(retryRes);
      expect(retryUnwrapped.status).toBe(200);
      expect(retryUnwrapped.data.synced).toBe(true);

      // Reload and re-render: badge is now "Synced"
      const postRetryLoaderRes = await indexLoader(
        createLoaderArgs(new Request("https://test-shop.myshopify.com/app/options")),
      );
      loaderData = (await unwrapResponse<IndexLoaderResult>(postRetryLoaderRes)).data;
      rerender(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );
      expect(screen.getByText("Synced")).toBeTruthy();

      // C. CONFIRMED DELETE: click Delete group for Group B, then click Confirm delete in modal
      const deleteGroupButtons = screen.getAllByRole("button", { name: "Delete group" });
      // Click delete on Group B (first group)
      fireEvent.click(deleteGroupButtons[0]);

      // Modal should display prompt
      expect(screen.getByText(/Are you sure you want to delete Material Group B\?/)).toBeTruthy();

      const deleteModal = container.querySelector("#delete-confirm-modal") as HTMLElement;
      const confirmDeleteBtn = within(deleteModal).getByRole("button", { name: "Confirm delete" });
      const deleteForm = confirmDeleteBtn.closest("form") as HTMLFormElement;
      expect(deleteForm).not.toBeNull();

      let deleteSubmittedData: FormData | null = null;
      deleteForm.addEventListener("submit", (e) => {
        e.preventDefault();
        deleteSubmittedData = new FormData(deleteForm);
      });

      fireEvent.click(confirmDeleteBtn);
      expect(deleteSubmittedData).not.toBeNull();
      expect(deleteSubmittedData!.get("intent")).toBe("delete_group");
      expect(deleteSubmittedData!.get("groupId")).toBe(g2.id);

      // Execute delete action
      const deleteReq = new Request("https://test-shop.myshopify.com/app/options", {
        method: "POST",
        body: deleteSubmittedData!,
      });
      const deleteRes = await indexAction(createActionArgs(deleteReq));
      const deleteUnwrapped = await unwrapResponse<{ ok: boolean }>(deleteRes);
      expect(deleteUnwrapped.status).toBe(200);
      expect(deleteUnwrapped.data.ok).toBe(true);

      // Reload and re-render: Group B is deleted and no longer in UI
      const postDeleteLoaderRes = await indexLoader(
        createLoaderArgs(new Request("https://test-shop.myshopify.com/app/options")),
      );
      loaderData = (await unwrapResponse<IndexLoaderResult>(postDeleteLoaderRes)).data;
      rerender(
        <ReactRouter.MemoryRouter>
          <AdminOptionsIndexRoute />
        </ReactRouter.MemoryRouter>,
      );
      expect(screen.queryByText("Material Group B")).toBeNull();
      expect(screen.getByText("Material Group A")).toBeTruthy();
    });
  });

});
