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
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";

import { createTestDb, type TestDb } from "../../../test/db";
import { createCatalogRepository } from "./catalog.repository.server";
import { createCatalogService } from "./catalog.service.server";
import {
  formatLimitsSummary,
  formatPriceDisplay,
  LensesList,
  action as listAction,
  loader as listLoader,
} from "../../routes/app.lenses._index";
import LensEditRoute, {
  action as lensAction,
  loader as lensLoader,
} from "../../routes/app.lenses.$id";
import LensGroupEditRoute, {
  action as groupAction,
  loader as groupLoader,
} from "../../routes/app.lens-groups.$id";
import { LensForm } from "./components/lens-form";

const DB_TIMEOUT_MS = 120_000;

const mocks = vi.hoisted(() => ({
  currentShop: "test-shop.myshopify.com",
  adminGraphql: vi.fn(),
  failProductCreate: false,
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: mocks.currentShop },
      admin: {
        graphql: mocks.adminGraphql,
      },
      redirect: vi.fn((url: string) => new Response(null, { status: 302, headers: { Location: url } })),
    })),
  },
}));

vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({
    toast: { show: vi.fn() },
  }),
}));

let db: TestDb | undefined;

function getTestPrisma() {
  if (!db) throw new Error("Test database not initialized");
  return db.prisma;
}

beforeAll(async () => {
  db = await createTestDb();
  (globalThis as Record<string, unknown>).__prismaClient = db.prisma;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  (globalThis as Record<string, unknown>).__prismaClient = undefined;
  await db?.drop();
}, DB_TIMEOUT_MS);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  testConfig();
  mocks.failProductCreate = false;

  // Mock ReactRouter useFetcher by default for standalone component rendering
  vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
    data: undefined,
    state: "idle",
    Form: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => (
      <form {...props}>{children}</form>
    ),
    submit: vi.fn(),
    load: vi.fn(),
  } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

  // Mock globalThis.fetch for billing plan lookup (active Pro plan)
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
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

  // Setup default Shopify Admin GraphQL responses
  mocks.adminGraphql.mockImplementation(async (query: string) => {
    if (query.includes("AppPlanShopId")) {
      return new Response(
        JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1001" } } }),
        { status: 200 },
      );
    }
    if (
      query.includes("currentAppInstallation") ||
      query.includes("AppPlanCurrentInstallation")
    ) {
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
        { status: 200 },
      );
    }
    if (query.includes("ShopCurrency")) {
      return new Response(
        JSON.stringify({ data: { shop: { currencyCode: "USD" } } }),
        { status: 200 },
      );
    }
    if (query.includes("GetPublications")) {
      return new Response(
        JSON.stringify({
          data: {
            publications: {
              nodes: [
                {
                  id: "gid://shopify/Publication/1",
                  name: "Online Store",
                },
              ],
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("ProductCreate")) {
      if (mocks.failProductCreate) {
        return new Response(
          JSON.stringify({
            errors: [{ message: "Shopify API product create failure" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/100",
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/200",
                    },
                  ],
                },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("productVariantsBulkUpdate")) {
      return new Response(
        JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/200",
                  price: "80.00",
                },
              ],
              userErrors: [],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("publishablePublish")) {
      return new Response(
        JSON.stringify({
          data: {
            publishablePublish: {
              publishable: {
                id: "gid://shopify/Product/100",
              },
              userErrors: [],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("productUpdate")) {
      return new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/100",
                status: "DRAFT",
              },
              userErrors: [],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("GetVariantProduct")) {
      return new Response(
        JSON.stringify({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/200",
              product: {
                id: "gid://shopify/Product/100",
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    if (query.includes("AppPlanShopId")) {
      return new Response(
        JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1001" } } }),
        { status: 200 },
      );
    }
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
      { status: 200 },
    );
  });
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
): ReactRouter.ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as ReactRouter.ActionFunctionArgs;
}

function createLoaderArgs(
  request: Request,
  params: Record<string, string> = {},
): ReactRouter.LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as ReactRouter.LoaderFunctionArgs;
}

async function unwrapResponse<T = Record<string, unknown>>(
  result: unknown,
): Promise<{
  status: number;
  location?: string | null;
  data: T;
}> {
  if (result instanceof Response) {
    const location = result.headers.get("Location");
    let json: T = {} as T;
    try {
      json = (await result.clone().json()) as T;
    } catch {
      // not json or empty
    }
    return {
      status: result.status,
      location,
      data: json,
    };
  }
  if (
    result &&
    typeof result === "object" &&
    "type" in result &&
    (result as { type: string }).type === "DataWithResponseInit"
  ) {
    const r = result as unknown as {
      data: T;
      init?: { status?: number; headers?: Headers };
    };
    return {
      status: r.init?.status ?? 200,
      location: r.init?.headers?.get?.("Location") ?? null,
      data: r.data,
    };
  }
  return {
    status: 200,
    data: result as T,
  };
}

describe("Spec 18 — Admin: lens groups and lenses", () => {
  describe("Examples table cases", () => {
    it("Row 1: SPH min '-8', max '+6.00' -> saved −800/600; list shows 'SPH −8.00 to +6.00' (normal)", async () => {
      const shopDomain = "example-row1.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      // Seed a lens group
      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, {
        name: "Standard Lenses",
        description: "Standard daily lenses",
      });

      // Submit lens creation form with SPH min "-8" and max "+6.00"
      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Clear 1.50");
      formData.append("description", "Standard index");
      formData.append("price", "80.00");
      formData.append("currency", "USD");
      formData.append("sphMin", "-8");
      formData.append("sphMax", "+6.00");
      formData.append("cylMin", "-2.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "SINGLE_VISION");
      formData.append(
        "labCodeTemplate",
        "PO-58-[lens_type=NONE]-[lens_color=NONE]-00",
      );

      const request = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const response = await lensAction(createActionArgs(request, { id: "new" }));
      const unwrapped = await unwrapResponse(response);

      // Successfully saved and redirected
      expect(unwrapped.status).toBe(302);
      expect(unwrapped.location).toBe("/app/lenses");

      // Verify repository/DB stored exact hundredths (INV-5)
      const savedLenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(savedLenses.length).toBe(1);
      const saved = savedLenses[0];
      expect(saved.sphMin).toBe(-800);
      expect(saved.sphMax).toBe(600);
      expect(Number.isInteger(saved.sphMin)).toBe(true);
      expect(Number.isInteger(saved.sphMax)).toBe(true);

      // Verify list renders summary "SPH −8.00 to +6.00"
      const service = createCatalogService({ prisma: getTestPrisma() });
      const groupsWithLenses = await service.listLensGroups(shopId);

      render(<LensesList groups={groupsWithLenses} />);
      expect(screen.getByText(/SPH −8\.00 to \+6\.00/)).not.toBeNull();
      expect(screen.getByText("Clear 1.50")).not.toBeNull();
    }, DB_TIMEOUT_MS);

    it("Row 2: SPH min '+6', max '-8' -> inline error on SPH max (LIMITS_INVERTED) (invalid)", async () => {
      const shopDomain = "example-row2.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, {
        name: "Inverted Limits Group",
      });

      // 1. Action validation test
      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Inverted Lens");
      formData.append("price", "50.00");
      formData.append("currency", "USD");
      formData.append("sphMin", "+6");
      formData.append("sphMax", "-8");
      formData.append("cylMin", "-2.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "SINGLE_VISION");
      formData.append("labCodeTemplate", "PO-58-00");

      const request = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const response = await lensAction(createActionArgs(request, { id: "new" }));
      const unwrapped = await unwrapResponse<{
        error: { code: string; fields?: Array<{ path: string; code: string }> };
      }>(response);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("LIMITS_INVERTED");
      expect(unwrapped.data.error.fields).toEqual([
        { path: "sphMax", code: "LIMITS_INVERTED" },
      ]);

      // Nothing was saved
      const saved = await repo.listLenses(shopId);
      expect(saved.length).toBe(0);

      // 2. UI component test: renders inline LIMITS_INVERTED on SPH max and disables Save
      render(
        <LensForm
          groups={[{ id: group.id, name: group.name, position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId={group.id}
          defaultValues={{ sphMin: "+6", sphMax: "-8" }}
        />,
      );

      // Inline error visible
      expect(screen.getByText("LIMITS_INVERTED")).not.toBeNull();

      // Save button disabled
      const saveButton =
        screen.getByText("Save").closest("s-button") ?? screen.getByText("Save");
      expect(saveButton.hasAttribute("disabled")).toBe(true);
    }, DB_TIMEOUT_MS);

    it("Row 3: template PO-[x=A -> inline UNCLOSED_TOKEN, save disabled (template error)", async () => {
      const shopDomain = "example-row3.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Template Group" });

      // 1. Action test: template error rejected with 400
      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Broken Template Lens");
      formData.append("price", "75.00");
      formData.append("sphMin", "-4.00");
      formData.append("sphMax", "+4.00");
      formData.append("cylMin", "-2.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "SINGLE_VISION");
      formData.append("labCodeTemplate", "PO-[x=A");

      const request = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const response = await lensAction(createActionArgs(request, { id: "new" }));
      const unwrapped = await unwrapResponse<{
        error: { code: string; fields?: Array<{ path: string; code: string }> };
      }>(response);

      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("UNCLOSED_TOKEN");

      // 2. UI component test: shows inline UNCLOSED_TOKEN and save button disabled
      render(
        <LensForm
          groups={[{ id: group.id, name: group.name, position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId={group.id}
          defaultValues={{ labCodeTemplate: "PO-[x=A" }}
        />,
      );

      expect(screen.getByText("UNCLOSED_TOKEN")).not.toBeNull();
      const saveButton =
        screen.getByText("Save").closest("s-button") ?? screen.getByText("Save");
      expect(saveButton.hasAttribute("disabled")).toBe(true);
    }, DB_TIMEOUT_MS);

    it("Row 4: save ok, Shopify sync fails -> saved; badge 'Sync failed', Retry visible (partial failure)", async () => {
      const shopDomain = "example-row4.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Sync Failure Group" });

      // Configure Shopify API sync to fail
      mocks.failProductCreate = true;

      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "High Index 1.67");
      formData.append("price", "120.00");
      formData.append("sphMin", "-10.00");
      formData.append("sphMax", "+6.00");
      formData.append("cylMin", "-3.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "SINGLE_VISION");
      formData.append("labCodeTemplate", "PO-67-00");

      const request = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const response = await lensAction(createActionArgs(request, { id: "new" }));
      const unwrapped = await unwrapResponse(response);

      // Self-check 2: Save succeeded in DB despite sync failure!
      const savedLenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(savedLenses.length).toBe(1);
      const savedLens = savedLenses[0];
      expect(savedLens.name).toBe("High Index 1.67");
      expect(savedLens.shopifyVariantId).toBeNull();

      // Redirects with syncFailed parameter
      expect(unwrapped.status).toBe(302);
      expect(unwrapped.location).toBe(`/app/lenses?syncFailed=${savedLens.id}`);

      // List renders with "Sync failed" badge and "Retry" button
      const service = createCatalogService({ prisma: getTestPrisma() });
      const groupsWithLenses = await service.listLensGroups(shopId);

      const { rerender } = render(
        <LensesList
          groups={groupsWithLenses}
          syncFailedId={savedLens.id}
        />,
      );

      expect(screen.getByText("Sync failed")).not.toBeNull();
      expect(screen.getByText("Retry")).not.toBeNull();

      // Retry sync: simulate clicking Retry
      mocks.failProductCreate = false; // Now Shopify API recovers

      const retryFormData = new FormData();
      retryFormData.append("intent", "retry-sync");
      retryFormData.append("lensId", savedLens.id);

      const retryRequest = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: retryFormData,
      });

      const retryResponse = await listAction(createActionArgs(retryRequest));
      const retryResult = await unwrapResponse<{ ok: boolean; synced: boolean }>(retryResponse);

      expect(retryResult.status).toBe(200);
      expect(retryResult.data.ok).toBe(true);
      expect(retryResult.data.synced).toBe(true);

      // Verify the lens is now synced in DB
      const updatedLens = await repo.getLens(shopId, savedLens.id);
      expect(updatedLens?.shopifyVariantId).toBe("gid://shopify/ProductVariant/200");

      // Rerender list with updated data: badge is now "Synced"
      const updatedGroups = await service.listLensGroups(shopId);
      rerender(<LensesList groups={updatedGroups} syncFailedId={null} />);

      expect(screen.getByText("Synced")).not.toBeNull();
      expect(screen.queryByText("Sync failed")).toBeNull();
    }, DB_TIMEOUT_MS);

    it("Row 5: archive confirmed -> gone from list, product drafted (archive)", async () => {
      const shopDomain = "example-row5.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Archivable Group" });

      // Create a synced lens
      const lens = await repo.createLens(shopId, {
        groupId: group.id,
        name: "To Be Archived Lens",
        priceMinor: 6000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "PO-50-00",
        shopifyProductId: "gid://shopify/Product/100",
        shopifyVariantId: "gid://shopify/ProductVariant/200",
      });

      // Submit archive action
      const formData = new FormData();
      formData.append("intent", "archive-lens");
      formData.append("lensId", lens.id);

      const request = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: formData,
      });

      const response = await listAction(createActionArgs(request));
      const unwrapped = await unwrapResponse<{ ok: boolean; archivedLensId: string }>(response);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.archivedLensId).toBe(lens.id);

      // Verify Shopify productUpdate was called to draft the product
      const calls = mocks.adminGraphql.mock.calls;
      const productUpdateCall = calls.find((call) =>
        String(call[0]).includes("productUpdate"),
      );
      expect(productUpdateCall).toBeDefined();

      // Verify DB row has archivedAt set (soft-deleted)
      const rawLens = await getTestPrisma().lens.findUnique({
        where: { shopId_id: { shopId, id: lens.id } },
      });
      expect(rawLens?.archivedAt).not.toBeNull();

      // Verify lens is gone from active catalog
      const service = createCatalogService({ prisma: getTestPrisma() });
      const activeGroups = await service.listLensGroups(shopId, { includeArchived: false });
      const groupLenses = activeGroups[0]?.lenses ?? [];
      expect(groupLenses.some((l) => l.id === lens.id)).toBe(false);

      // Render active list: lens is not present
      render(<LensesList groups={activeGroups} />);
      expect(screen.queryByText("To Be Archived Lens")).toBeNull();
    }, DB_TIMEOUT_MS);
  });

  describe("Invariants & Security", () => {
    it("INV-1: an action posting another shop's lens id returns 404 and changes nothing", async () => {
      const shopA = await createShop("shop-a.myshopify.com");
      expect(shopA).toBeDefined();
      const shopB = await createShop("shop-b.myshopify.com");

      const repo = createCatalogRepository(getTestPrisma());
      const groupB = await repo.createLensGroup(shopB, { name: "Shop B Group" });
      const lensB = await repo.createLens(shopB, {
        groupId: groupB.id,
        name: "Shop B Lens",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-B-00",
      });

      // Authenticate as Shop A
      mocks.currentShop = "shop-a.myshopify.com";

      // 1. Attempt retry-sync on Shop B's lens
      const retryForm = new FormData();
      retryForm.append("intent", "retry-sync");
      retryForm.append("lensId", lensB.id);

      const retryReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: retryForm,
      });

      const retryRes = await listAction(createActionArgs(retryReq));
      const retryUnwrapped = await unwrapResponse(retryRes);
      expect(retryUnwrapped.status).toBe(404);

      // 2. Attempt archive-lens on Shop B's lens
      const archiveForm = new FormData();
      archiveForm.append("intent", "archive-lens");
      archiveForm.append("lensId", lensB.id);

      const archiveReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: archiveForm,
      });

      const archiveRes = await listAction(createActionArgs(archiveReq));
      const archiveUnwrapped = await unwrapResponse(archiveRes);
      expect(archiveUnwrapped.status).toBe(404);

      // 3. Attempt update on Shop B's lens route
      const updateForm = new FormData();
      updateForm.append("intent", "save");
      updateForm.append("groupId", groupB.id);
      updateForm.append("name", "Hacked Lens");
      updateForm.append("price", "1.00");
      updateForm.append("sphMin", "0.00");
      updateForm.append("sphMax", "0.00");
      updateForm.append("cylMin", "0.00");
      updateForm.append("cylMax", "0.00");
      updateForm.append("rxTypes", "SINGLE_VISION");
      updateForm.append("labCodeTemplate", "PO-00");

      const updateReq = new Request(`https://app.test/app/lenses/${lensB.id}`, {
        method: "POST",
        body: updateForm,
      });

      const updateRes = await lensAction(createActionArgs(updateReq, { id: lensB.id }));
      const updateUnwrapped = await unwrapResponse(updateRes);
      expect(updateUnwrapped.status).toBe(404);

      // Verify Shop B's lens remains completely unchanged
      const rawLensB = await getTestPrisma().lens.findUnique({
        where: { shopId_id: { shopId: shopB, id: lensB.id } },
      });
      expect(rawLensB).not.toBeNull();
      expect(rawLensB?.name).toBe("Shop B Lens");
      expect(rawLensB?.archivedAt).toBeNull();
      expect(rawLensB?.priceMinor).toBe(5000);
    }, DB_TIMEOUT_MS);

    it("INV-5: limits entered as text are stored as integer hundredths (asserted on the repository)", async () => {
      const shopDomain = "inv5-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "INV-5 Group" });

      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Precision Diopter Lens");
      formData.append("price", "99.00");
      formData.append("sphMin", "-8");
      formData.append("sphMax", "+6.00");
      formData.append("cylMin", "-2.25");
      formData.append("cylMax", "0");
      formData.append("addMin", "+1.50");
      formData.append("addMax", "+2.75");
      formData.append("rxTypes", "PROGRESSIVE");
      formData.append("labCodeTemplate", "PO-PRE-00");

      const req = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const res = await lensAction(createActionArgs(req, { id: "new" }));
      expect((await unwrapResponse(res)).status).toBe(302);

      const lenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(lenses.length).toBe(1);
      const l = lenses[0];

      expect(l.sphMin).toBe(-800);
      expect(l.sphMax).toBe(600);
      expect(l.cylMin).toBe(-225);
      expect(l.cylMax).toBe(0);
      expect(l.addMin).toBe(150);
      expect(l.addMax).toBe(275);

      expect(Number.isInteger(l.sphMin)).toBe(true);
      expect(Number.isInteger(l.sphMax)).toBe(true);
      expect(Number.isInteger(l.cylMin)).toBe(true);
      expect(Number.isInteger(l.cylMax)).toBe(true);
      expect(Number.isInteger(l.addMin)).toBe(true);
      expect(Number.isInteger(l.addMax)).toBe(true);
    }, DB_TIMEOUT_MS);
  });

  describe("UI Checklist & List States", () => {
    it("renders empty state with 'Add lens group'", () => {
      const { container } = render(<LensesList groups={[]} />);
      const emptyState = container.querySelector('s-empty-state[heading="No lens groups yet"]');
      expect(emptyState).not.toBeNull();
      expect(screen.getAllByText("Add lens group").length).toBeGreaterThan(0);
    });

    it("renders populated state with groups, lenses, price, Rx types, limits summary, and sync badge", () => {
      const mockGroups = [
        {
          id: "g1",
          name: "Single Vision Group",
          description: "For distance or near vision",
          position: 0,
          archivedAt: null,
          lenses: [
            {
              id: "l1",
              groupId: "g1",
              name: "Standard Clear",
              description: "Basic CR-39 lens",
              price: { amountMinor: 8000, currency: "USD" },
              limits: {
                sphMin: -800,
                sphMax: 600,
                cylMin: -400,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION" as const],
              },
              labCodeTemplate: "PO-58-00",
              shopifyProductId: "gid://shopify/Product/1",
              shopifyVariantId: "gid://shopify/ProductVariant/2",
              position: 0,
              archivedAt: null,
            },
          ],
        },
      ];

      const { container } = render(<LensesList groups={mockGroups} />);

      const section = container.querySelector('s-section[heading="Single Vision Group"]');
      expect(section).not.toBeNull();
      expect(screen.getByText("Standard Clear")).not.toBeNull();
      expect(screen.getByText("Price: USD 80.00")).not.toBeNull();
      expect(screen.getByText("Rx types: SINGLE_VISION")).not.toBeNull();
      expect(screen.getByText(/SPH −8\.00 to \+6\.00/)).not.toBeNull();
      expect(screen.getByText("Synced")).not.toBeNull();
    });

    it("renders sync-failed state with badge 'Sync failed' and 'Retry' button", () => {
      const mockGroups = [
        {
          id: "g1",
          name: "Test Group",
          position: 0,
          archivedAt: null,
          lenses: [
            {
              id: "l_fail",
              groupId: "g1",
              name: "Unsynced Lens",
              price: { amountMinor: 5000, currency: "USD" },
              limits: {
                sphMin: -400,
                sphMax: 400,
                cylMin: 0,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION" as const],
              },
              labCodeTemplate: "PO-50-00",
              shopifyProductId: null,
              shopifyVariantId: null,
              position: 0,
              archivedAt: null,
            },
          ],
        },
      ];

      render(<LensesList groups={mockGroups} syncFailedId="l_fail" />);

      expect(screen.getByText("Sync failed")).not.toBeNull();
      expect(screen.getByText("Retry")).not.toBeNull();
    });

    it("renders loading state with spinner", () => {
      render(<LensesList groups={[]} isLoading={true} />);
      const spinner = document.querySelector("s-spinner");
      expect(spinner).not.toBeNull();
    });

    it("renders live preview of lab code template with default tokens", () => {
      render(
        <LensForm
          groups={[{ id: "g1", name: "G1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
          defaultValues={{
            labCodeTemplate: "PO-58-[lens_type=NONE]-[lens_color=NONE]-00",
          }}
        />,
      );

      expect(screen.getByText("PO-58-NONE-NONE-00")).not.toBeNull();
    });
  });

  describe("Lens Groups CRUD & Reorder", () => {
    it("creates, updates, and archives a lens group", async () => {
      const shopDomain = "group-crud.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      // 1. Create group
      const createForm = new FormData();
      createForm.append("name", "Bifocals");
      createForm.append("description", "Classic lined bifocals");

      const createReq = new Request("https://app.test/app/lens-groups/new", {
        method: "POST",
        body: createForm,
      });

      const createRes = await groupAction(createActionArgs(createReq, { id: "new" }));
      expect((await unwrapResponse(createRes)).status).toBe(302);

      const repo = createCatalogRepository(getTestPrisma());
      const groups = await repo.listLensGroups(shopId);
      expect(groups.length).toBe(1);
      const group = groups[0];
      expect(group.name).toBe("Bifocals");
      expect(group.description).toBe("Classic lined bifocals");

      // 2. Update group
      const updateForm = new FormData();
      updateForm.append("name", "Premium Bifocals");
      updateForm.append("description", "Premium lined bifocals");

      const updateReq = new Request(`https://app.test/app/lens-groups/${group.id}`, {
        method: "POST",
        body: updateForm,
      });

      const updateRes = await groupAction(createActionArgs(updateReq, { id: group.id }));
      expect((await unwrapResponse(updateRes)).status).toBe(302);

      const updated = await repo.getLensGroup(shopId, group.id);
      expect(updated?.name).toBe("Premium Bifocals");

      // 3. Archive group
      const archiveForm = new FormData();
      archiveForm.append("intent", "archive");

      const archiveReq = new Request(`https://app.test/app/lens-groups/${group.id}`, {
        method: "POST",
        body: archiveForm,
      });

      const archiveRes = await groupAction(createActionArgs(archiveReq, { id: group.id }));
      expect((await unwrapResponse(archiveRes)).status).toBe(302);

      const activeGroups = await repo.listLensGroups(shopId, { includeArchived: false });
      expect(activeGroups.length).toBe(0);
    }, DB_TIMEOUT_MS);

    it("reorders lens groups and lenses", async () => {
      const shopDomain = "reorder-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const g1 = await repo.createLensGroup(shopId, { name: "Group 1", position: 0 });
      const g2 = await repo.createLensGroup(shopId, { name: "Group 2", position: 1 });

      const l1 = await repo.createLens(shopId, {
        groupId: g1.id,
        name: "Lens 1",
        priceMinor: 1000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-1",
        position: 0,
      });
      const l2 = await repo.createLens(shopId, {
        groupId: g1.id,
        name: "Lens 2",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-2",
        position: 1,
      });

      // Reorder groups: g2 before g1
      const groupReorderForm = new FormData();
      groupReorderForm.append("intent", "reorder-groups");
      groupReorderForm.append("ids", `${g2.id},${g1.id}`);

      const groupReorderReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: groupReorderForm,
      });

      const groupRes = await listAction(createActionArgs(groupReorderReq));
      expect((await unwrapResponse(groupRes)).status).toBe(200);

      const reorderedGroups = await repo.listLensGroups(shopId);
      expect(reorderedGroups[0].id).toBe(g2.id);
      expect(reorderedGroups[1].id).toBe(g1.id);

      // Reorder lenses: l2 before l1
      const lensReorderForm = new FormData();
      lensReorderForm.append("intent", "reorder-lenses");
      lensReorderForm.append("groupId", g1.id);
      lensReorderForm.append("ids", `${l2.id},${l1.id}`);

      const lensReorderReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: lensReorderForm,
      });

      const lensRes = await listAction(createActionArgs(lensReorderReq));
      expect((await unwrapResponse(lensRes)).status).toBe(200);

      const reorderedLenses = await repo.listLenses(shopId, { groupId: g1.id });
      expect(reorderedLenses[0].id).toBe(l2.id);
      expect(reorderedLenses[1].id).toBe(l1.id);
    }, DB_TIMEOUT_MS);
  });

  describe("Helper functions & Route loaders", () => {
    it("formatLimitsSummary formats diopter limits correctly", () => {
      expect(formatLimitsSummary({ sphMin: -800, sphMax: 600 })).toBe(
        "SPH −8.00 to +6.00",
      );
      expect(
        formatLimitsSummary({
          sphMin: -400,
          sphMax: 400,
          cylMin: -200,
          cylMax: 0,
        }),
      ).toBe("SPH −4.00 to +4.00 · CYL −2.00 to PL");
      expect(
        formatLimitsSummary({
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
          addMin: 75,
          addMax: 350,
        }),
      ).toBe("SPH −2.00 to +2.00 · CYL −1.00 to PL · ADD +0.75 to +3.50");
    });

    it("formatPriceDisplay formats amounts in decimal", () => {
      expect(formatPriceDisplay(8000, "USD")).toBe("USD 80.00");
      expect(formatPriceDisplay(0, "USD")).toBe("USD 0.00");
    });

    it("listLoader, lensLoader, and groupLoader load initial state", async () => {
      const shopDomain = "loader-test.myshopify.com";
      await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const listRes = await listLoader(
        createLoaderArgs(new Request("https://app.test/app/lenses")),
      );
      const listData = await unwrapResponse(listRes);
      expect(listData.status).toBe(200);

      const groupRes = await groupLoader(
        createLoaderArgs(new Request("https://app.test/app/lens-groups/new"), {
          id: "new",
        }),
      );
      const groupData = await unwrapResponse(groupRes);
      expect(groupData.status).toBe(200);

      const lensRes = await lensLoader(
        createLoaderArgs(new Request("https://app.test/app/lenses/new"), {
          id: "new",
        }),
      );
      const lensData = await unwrapResponse(lensRes);
      expect(lensData.status).toBe(200);
    });

    it("exports route components as functions", () => {
      expect(typeof LensEditRoute).toBe("function");
      expect(typeof LensGroupEditRoute).toBe("function");
    });
  });
});
