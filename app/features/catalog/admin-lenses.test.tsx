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
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as ReactRouter from "react-router";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";

import { createTestDb, type TestDb } from "../../../test/db";
import { createCatalogRepository } from "./catalog.repository.server";
import * as catalogService from "./catalog.service.server";
import {
  createCatalogService,
  type CatalogLensDto,
  type CatalogLensGroupDto,
} from "./catalog.service.server";
import {
  formatLimitsSummary,
  formatPriceDisplay,
  LensesList,
  ErrorBoundary as ListErrorBoundary,
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

const actualUseFetcher = ReactRouter.useFetcher;

const DB_TIMEOUT_MS = 120_000;

const mocks = vi.hoisted(() => ({
  currentShop: "test-shop.myshopify.com",
  adminGraphql: vi.fn(),
  failProductCreate: false,
  fetcherSubmit: vi.fn(),
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
  mocks.fetcherSubmit = vi.fn();

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
    submit: mocks.fetcherSubmit,
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
      const retryBtn = screen.getByRole("button", { name: "Retry" });
      expect(retryBtn).not.toBeNull();

      // Retry sync: click Retry by role (R1-F8)
      mocks.failProductCreate = false; // Now Shopify API recovers

      fireEvent.click(retryBtn);

      expect(mocks.fetcherSubmit).toHaveBeenCalledWith(
        { intent: "retry-sync", lensId: savedLens.id },
        { method: "POST" },
      );

      // Execute listAction with the payload from the Retry click
      const retrySubmission = mocks.fetcherSubmit.mock.calls[0][0];
      const retryFormData = new FormData();
      for (const [k, v] of Object.entries(retrySubmission)) {
        retryFormData.append(k, String(v));
      }

      const retryRequest = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: retryFormData,
      });

      const retryResponse = await listAction(createActionArgs(retryRequest));
      const retryResult = await unwrapResponse<{ ok: boolean; synced: boolean }>(retryResponse);

      expect(retryResult.status).toBe(200);
      expect(retryResult.data.ok).toBe(true);
      expect(retryResult.data.synced).toBe(true);

      // Verify the lens is now synced in DB (syncItem was called again)
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

      const service = createCatalogService({ prisma: getTestPrisma() });
      const initialGroups = await service.listLensGroups(shopId, { includeArchived: false });

      // 1. Render active list with the lens
      render(<LensesList groups={initialGroups} />);
      expect(screen.getByText("To Be Archived Lens")).not.toBeNull();

      // Spy on modal showOverlay/hideOverlay (R2-F4)
      const modal = document.getElementById("archive-confirm-modal") as HTMLElement & {
        showOverlay?: ReturnType<typeof vi.fn>;
        hideOverlay?: ReturnType<typeof vi.fn>;
      };
      expect(modal).not.toBeNull();
      const showOverlaySpy = vi.fn();
      const hideOverlaySpy = vi.fn();
      modal.showOverlay = showOverlaySpy;
      modal.hideOverlay = hideOverlaySpy;

      expect(showOverlaySpy).not.toHaveBeenCalled();
      expect(hideOverlaySpy).not.toHaveBeenCalled();

      // 2. Click "Archive lens" by role to open confirmation modal (R1-F5, R2-F4)
      const archiveButtons = screen.getAllByRole("button", { name: "Archive lens" });
      fireEvent.click(archiveButtons[0]);

      // 3. Verify confirmation modal is shown (showOverlay called) and contains the lens name
      expect(showOverlaySpy).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/Are you sure you want to archive To Be Archived Lens/),
      ).not.toBeNull();

      // 4. Click "Confirm archive" inside the modal by role
      const confirmBtn = screen.getByRole("button", { name: "Confirm archive" });
      fireEvent.click(confirmBtn);

      // Verify hideOverlay was called and submit was triggered
      expect(hideOverlaySpy).toHaveBeenCalledTimes(1);
      expect(mocks.fetcherSubmit).toHaveBeenCalledWith(
        { intent: "archive-lens", lensId: lens.id },
        { method: "POST" },
      );

      // 5. Submit archive action with the modal submission
      const archiveSubmission = mocks.fetcherSubmit.mock.calls[0][0];
      const formData = new FormData();
      for (const [k, v] of Object.entries(archiveSubmission)) {
        formData.append(k, String(v));
      }

      const request = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: formData,
      });

      const response = await listAction(createActionArgs(request));
      const unwrapped = await unwrapResponse<{ ok: boolean; archivedLensId: string }>(response);

      expect(unwrapped.status).toBe(200);
      expect(unwrapped.data.ok).toBe(true);
      expect(unwrapped.data.archivedLensId).toBe(lens.id);

      // 6. Verify Shopify productUpdate GraphQL was called with status: DRAFT and product id
      const calls = mocks.adminGraphql.mock.calls;
      const productUpdateCall = calls.find((call) =>
        String(call[0]).includes("productUpdate") || String(call[0]).includes("ProductUpdate"),
      );
      expect(productUpdateCall).toBeDefined();
      expect(productUpdateCall![1]?.variables?.product).toEqual({
        id: lens.shopifyProductId,
        status: "DRAFT",
      });

      // 7. Verify DB row has archivedAt set (soft-deleted)
      const rawLens = await getTestPrisma().lens.findUnique({
        where: { shopId_id: { shopId, id: lens.id } },
      });
      expect(rawLens?.archivedAt).not.toBeNull();

      // 8. Verify lens is gone from active catalog
      const activeGroups = await service.listLensGroups(shopId, { includeArchived: false });
      const groupLenses = activeGroups[0]?.lenses ?? [];
      expect(groupLenses.some((l) => l.id === lens.id)).toBe(false);

      // 9. Render active list: lens is not present
      cleanup();
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

    it("rejects null, non-object, and malformed JSON payloads with 400 INVALID_INPUT (R1-F6)", async () => {
      const shopDomain = "json-schema-test.myshopify.com";
      await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const actions = [
        { name: "listAction", fn: (req: Request) => listAction(createActionArgs(req)) },
        { name: "groupAction", fn: (req: Request) => groupAction(createActionArgs(req, { id: "new" })) },
        { name: "lensAction", fn: (req: Request) => lensAction(createActionArgs(req, { id: "new" })) },
      ];

      for (const actionEntry of actions) {
        // null JSON
        const nullReq = new Request("https://app.test/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "null",
        });
        const nullRes = await actionEntry.fn(nullReq);
        const nullUnwrapped = await unwrapResponse(nullRes);
        expect(nullUnwrapped.status).toBe(400);
        expect((nullUnwrapped.data as { error: { code: string } }).error.code).toBe("INVALID_INPUT");

        // number JSON
        const numReq = new Request("https://app.test/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "123",
        });
        const numRes = await actionEntry.fn(numReq);
        const numUnwrapped = await unwrapResponse(numRes);
        expect(numUnwrapped.status).toBe(400);
        expect((numUnwrapped.data as { error: { code: string } }).error.code).toBe("INVALID_INPUT");

        // array JSON
        const arrReq = new Request("https://app.test/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(["foo", "bar"]),
        });
        const arrRes = await actionEntry.fn(arrReq);
        const arrUnwrapped = await unwrapResponse(arrRes);
        expect(arrUnwrapped.status).toBe(400);
        expect((arrUnwrapped.data as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
      }
    }, DB_TIMEOUT_MS);

    it("rejects malformed field types across all three actions with 400 and field paths (R2-F1)", async () => {
      const shopDomain = "malformed-fields-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Schema Test Group" });

      // 1. groupAction: malformed name field { name: {} }
      const groupReq = new Request("https://app.test/app/lens-groups/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "save", name: {}, description: "Test" }),
      });
      const groupRes = await groupAction(createActionArgs(groupReq, { id: "new" }));
      const groupUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(groupRes);
      expect(groupUnwrapped.status).toBe(400);
      expect(groupUnwrapped.data.error.fields?.some((f) => f.path === "name")).toBe(true);

      // groupAction: malformed description field { description: 123 }
      const groupDescReq = new Request("https://app.test/app/lens-groups/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "save", name: "Valid Name", description: 123 }),
      });
      const groupDescRes = await groupAction(createActionArgs(groupDescReq, { id: "new" }));
      const groupDescUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(groupDescRes);
      expect(groupDescUnwrapped.status).toBe(400);
      expect(groupDescUnwrapped.data.error.fields?.some((f) => f.path === "description")).toBe(true);

      // 2. listAction: malformed lensId in archive-lens { intent: "archive-lens", lensId: {} }
      const listReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "archive-lens", lensId: {} }),
      });
      const listRes = await listAction(createActionArgs(listReq));
      const listUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(listRes);
      expect(listUnwrapped.status).toBe(400);
      expect(listUnwrapped.data.error.fields?.some((f) => f.path === "lensId")).toBe(true);

      // listAction: malformed ids in reorder-lenses { intent: "reorder-lenses", groupId: group.id, ids: {} }
      const listReorderReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "reorder-lenses", groupId: group.id, ids: {} }),
      });
      const listReorderRes = await listAction(createActionArgs(listReorderReq));
      const listReorderUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(listReorderRes);
      expect(listReorderUnwrapped.status).toBe(400);
      expect(listReorderUnwrapped.data.error.fields?.some((f) => f.path === "ids")).toBe(true);

      // 3. lensAction: malformed name { name: {} }
      const lensReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: {},
          price: "50.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "TEST-[material=POLY]",
        }),
      });
      const lensRes = await lensAction(createActionArgs(lensReq, { id: "new" }));
      const lensUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(lensRes);
      expect(lensUnwrapped.status).toBe(400);
      expect(lensUnwrapped.data.error.fields?.some((f) => f.path === "name")).toBe(true);

      // lensAction: invalid enum members in rxTypes (must be rejected, not filtered)
      const lensRxReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "Invalid Rx Lens",
          price: "50.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["NOT_A_VALID_RX_TYPE"],
          labCodeTemplate: "TEST-[material=POLY]",
        }),
      });
      const lensRxRes = await lensAction(createActionArgs(lensRxReq, { id: "new" }));
      const lensRxUnwrapped = await unwrapResponse<{ error: { code: string; fields?: Array<{ path: string; code: string }> } }>(lensRxRes);
      expect(lensRxUnwrapped.status).toBe(400);
      expect(lensRxUnwrapped.data.error.fields?.some((f) => f.path.startsWith("rxTypes"))).toBe(true);
    }, DB_TIMEOUT_MS);

    it("fails the save with visible error and no write when Shopify currency is missing or erroneous (R2-F2)", async () => {
      const shopDomain = "currency-fail-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "No Currency Group" });

      const countBefore = await getTestPrisma().lens.count({ where: { shopId } });

      // Mock admin GraphQL to return error for ShopCurrency
      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(
            JSON.stringify({ errors: [{ message: "Internal server error" }] }),
            { status: 200 },
          );
        }
        return originalAdminGraphql?.(query, vars);
      });

      const req = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "Failed Currency Lens",
          price: "100.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "TEST-[material=POLY]",
        }),
      });

      const res = await lensAction(createActionArgs(req, { id: "new" }));
      const unwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(res);
      expect(unwrapped.status).toBe(400);
      expect(unwrapped.data.error.code).toBe("CURRENCY_FETCH_FAILED");

      // Verify no DB write occurred
      const countAfter = await getTestPrisma().lens.count({ where: { shopId } });
      expect(countAfter).toBe(countBefore);

      // Verify GraphQL returning null currencyCode also fails save
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(
            JSON.stringify({ data: { shop: { currencyCode: null } } }),
            { status: 200 },
          );
        }
        return originalAdminGraphql?.(query, vars);
      });

      const reqNull = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "Failed Currency Lens 2",
          price: "100.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "TEST-[material=POLY]",
        }),
      });

      const resNull = await lensAction(createActionArgs(reqNull, { id: "new" }));
      const unwrappedNull = await unwrapResponse<{ error: { code: string; message: string } }>(resNull);
      expect(unwrappedNull.status).toBe(400);
      expect(unwrappedNull.data.error.code).toBe("CURRENCY_FETCH_FAILED");

      const countAfterNull = await getTestPrisma().lens.count({ where: { shopId } });
      expect(countAfterNull).toBe(countBefore);

      if (originalAdminGraphql) {
        mocks.adminGraphql.mockImplementation(originalAdminGraphql);
      }
    }, DB_TIMEOUT_MS);

    it("refuses loader and save action for archived lenses and archived target groups with 404 (R2-F3)", async () => {
      const shopDomain = "archived-lens-refusal.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Active Group" });
      const archivedGroup = await repo.createLensGroup(shopId, { name: "Archived Group" });
      await repo.deleteLensGroup(shopId, archivedGroup.id);

      const lens = await repo.createLens(shopId, {
        groupId: group.id,
        name: "Lens To Archive",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        labCodeTemplate: "LENS-[material=POLY]",
      });

      // Archive the lens
      await repo.deleteLens(shopId, lens.id);

      // 1. Loader returns 404 for archived lens
      const loaderReq = new Request(`https://app.test/app/lenses/${lens.id}`);
      try {
        await lensLoader(createLoaderArgs(loaderReq, { id: lens.id }));
        expect.unreachable("Loader should throw on archived lens");
      } catch (thrown) {
        const unwrapped = await unwrapResponse(thrown);
        expect(unwrapped.status).toBe(404);
      }

      // 2. Save action refuses editing archived lens (404, no write, no sync)
      mocks.adminGraphql.mockClear();
      const saveReq = new Request(`https://app.test/app/lenses/${lens.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "Attempted Re-edit",
          price: "60.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "LENS-[material=POLY]",
        }),
      });

      const saveRes = await lensAction(createActionArgs(saveReq, { id: lens.id }));
      const saveUnwrapped = await unwrapResponse(saveRes);
      expect(saveUnwrapped.status).toBe(404);

      // Assert no DB write happened
      const dbLens = await getTestPrisma().lens.findUnique({
        where: { shopId_id: { shopId, id: lens.id } },
      });
      expect(dbLens?.name).toBe("Lens To Archive");

      // Assert no syncItem / productUpdate was called
      const calls = mocks.adminGraphql.mock.calls;
      const productUpdateCall = calls.find((call) =>
        String(call[0]).includes("ProductUpdate") || String(call[0]).includes("productUpdate"),
      );
      expect(productUpdateCall).toBeUndefined();

      // 3. Save action refuses saving into archived target group (404, no write, no sync)
      const saveToArchivedGroupReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: archivedGroup.id,
          name: "Lens In Archived Group",
          price: "60.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "-1.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "LENS-[material=POLY]",
        }),
      });

      const groupRes = await lensAction(createActionArgs(saveToArchivedGroupReq, { id: "new" }));
      const groupUnwrapped = await unwrapResponse(groupRes);
      expect(groupUnwrapped.status).toBe(404);
      const afterCount = await getTestPrisma().lens.count({
        where: { shopId, groupId: archivedGroup.id },
      });
      expect(afterCount).toBe(0);

      // 4. Save action refuses moving an existing lens into an archived target group (404, no write, no sync) (R5-F1)
      const activeLens = await repo.createLens(shopId, {
        groupId: group.id,
        name: "Active Lens In Active Group",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
      });

      mocks.adminGraphql.mockClear();
      const reparentReq = new Request(`https://app.test/app/lenses/${activeLens.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: archivedGroup.id,
          name: "Active Lens In Active Group",
          price: "40.00",
          sphMin: "-1.00",
          sphMax: "+1.00",
          cylMin: "0.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
        }),
      });

      const reparentRes = await lensAction(createActionArgs(reparentReq, { id: activeLens.id }));
      const reparentUnwrapped = await unwrapResponse(reparentRes);
      expect(reparentUnwrapped.status).toBe(404);

      // Assert no DB update happened on groupId
      const dbActiveLens = await getTestPrisma().lens.findUnique({
        where: { shopId_id: { shopId, id: activeLens.id } },
      });
      expect(dbActiveLens?.groupId).toBe(group.id);

      // Assert no syncItem / productUpdate was called
      const reparentCalls = mocks.adminGraphql.mock.calls;
      const productSyncCall = reparentCalls.find((call) =>
        String(call[0]).includes("ProductUpdate") || String(call[0]).includes("productUpdate"),
      );
      expect(productSyncCall).toBeUndefined();
    }, DB_TIMEOUT_MS);

    it("derives shop currency server-side for new lenses and rejects form data currency override (R1-F2)", async () => {
      const shopDomain = "currency-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      // Mock shop GraphQL to return EUR
      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(
            JSON.stringify({ data: { shop: { currencyCode: "EUR" } } }),
            { status: 200 },
          );
        }
        return originalAdminGraphql?.(query, vars);
      });

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Euro Group" });

      // 1. Loader returns shopCurrency: "EUR"
      const loaderReq = new Request("https://app.test/app/lenses/new");
      const loaderRes = await lensLoader(createLoaderArgs(loaderReq, { id: "new" }));
      const loaderData = await unwrapResponse<{ shopCurrency: string }>(loaderRes);
      expect(loaderData.status).toBe(200);
      expect(loaderData.data.shopCurrency).toBe("EUR");

      // 2. Action creates lens with EUR even if client attempts to pass USD
      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Euro Lens");
      formData.append("price", "75.00");
      formData.append("currency", "USD"); // Client attempts to override with USD
      formData.append("sphMin", "-4.00");
      formData.append("sphMax", "+4.00");
      formData.append("cylMin", "-2.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "SINGLE_VISION");
      formData.append("labCodeTemplate", "PO-EUR");

      const createReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });
      const createRes = await lensAction(createActionArgs(createReq, { id: "new" }));
      const createData = await unwrapResponse(createRes);
      expect(createData.status).toBe(302);

      const lenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(lenses.length).toBe(1);
      expect(lenses[0].currency).toBe("EUR"); // Server-side shop currency was used
      expect(lenses[0].shopifyVariantId).toBe("gid://shopify/ProductVariant/200"); // Sync succeeded with EUR
    }, DB_TIMEOUT_MS);

    it("submits NON_PRESCRIPTION rxType to action and saves lens (R1-F4)", async () => {
      const shopDomain = "non-prescription-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Non-Rx Group" });

      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("groupId", group.id);
      formData.append("name", "Plano Blue Light Lens");
      formData.append("price", "45.00");
      formData.append("sphMin", "0.00");
      formData.append("sphMax", "0.00");
      formData.append("cylMin", "0.00");
      formData.append("cylMax", "0.00");
      formData.append("rxTypes", "NON_PRESCRIPTION");
      formData.append("labCodeTemplate", "PO-PLANO");

      const req = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: formData,
      });

      const res = await lensAction(createActionArgs(req, { id: "new" }));
      expect((await unwrapResponse(res)).status).toBe(302);

      const lenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(lenses.length).toBe(1);
      expect(lenses[0].rxTypes).toEqual(["NON_PRESCRIPTION"]);
    }, DB_TIMEOUT_MS);

    it("leaves lens active and retryable when Shopify drafting fails during archive in both routes (R3-F1)", async () => {
      const shopDomain = "archive-failure-r3f1.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const service = createCatalogService({ prisma: getTestPrisma() });
      const group = await repo.createLensGroup(shopId, { name: "R3-F1 Group" });

      const lens1 = await repo.createLens(shopId, {
        groupId: group.id,
        name: "List Route Failure Lens",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-F1-01",
        shopifyProductId: "gid://shopify/Product/101",
        shopifyVariantId: "gid://shopify/ProductVariant/201",
      });

      const lens2 = await repo.createLens(shopId, {
        groupId: group.id,
        name: "Edit Route Failure Lens",
        priceMinor: 6000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-F1-02",
        shopifyProductId: "gid://shopify/Product/102",
        shopifyVariantId: "gid://shopify/ProductVariant/202",
      });

      // Mock admin GraphQL: productUpdate fails
      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("productUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                productUpdate: {
                  product: null,
                  userErrors: [{ message: "Shopify drafting failed", field: ["status"] }],
                },
              },
            }),
            { status: 200 },
          );
        }
        return originalAdminGraphql?.(query, vars);
      });

      // 1. Test failure path in listAction (app/routes/app.lenses._index.tsx)
      const listReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "archive-lens", lensId: lens1.id }),
      });
      const listRes = await listAction(createActionArgs(listReq));
      const listUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(listRes);
      expect(listUnwrapped.status).toBe(400);

      // Verify DB row has no archivedAt set (still active)
      const rawLens1 = await repo.getLens(shopId, lens1.id);
      expect(rawLens1?.archivedAt).toBeNull();

      // Verify lens1 is still listed in active groups
      const groupsAfterListFail = await service.listLensGroups(shopId, { includeArchived: false });
      expect(groupsAfterListFail[0].lenses.some((l) => l.id === lens1.id)).toBe(true);

      // Verify retryable (retry does not return 404)
      const retryListRes = await listAction(createActionArgs(listReq));
      const retryListUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(retryListRes);
      expect(retryListUnwrapped.status).toBe(400); // Fails with sync error, NOT 404 NotFound

      // 2. Test failure path in lensAction (app/routes/app.lenses.$id.tsx)
      const editReq = new Request(`https://app.test/app/lenses/${lens2.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "archive" }),
      });
      const editRes = await lensAction(createActionArgs(editReq, { id: lens2.id }));
      const editUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(editRes);
      expect(editUnwrapped.status).toBe(400);

      // Verify DB row has no archivedAt set (still active)
      const rawLens2 = await repo.getLens(shopId, lens2.id);
      expect(rawLens2?.archivedAt).toBeNull();

      // Verify lens2 is still listed in active groups
      const groupsAfterEditFail = await service.listLensGroups(shopId, { includeArchived: false });
      expect(groupsAfterEditFail[0].lenses.some((l) => l.id === lens2.id)).toBe(true);

      // Verify retryable (retry does not return 404)
      const retryEditRes = await lensAction(createActionArgs(editReq, { id: lens2.id }));
      const retryEditUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(retryEditRes);
      expect(retryEditUnwrapped.status).toBe(400); // Fails with sync error, NOT 404 NotFound

      if (originalAdminGraphql) {
        mocks.adminGraphql.mockImplementation(originalAdminGraphql);
      }
    }, DB_TIMEOUT_MS);

    it("archives lens from edit action independently of failing shop currency query (R3-F2)", async () => {
      const shopDomain = "archive-currency-fail-r3f2.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const service = createCatalogService({ prisma: getTestPrisma() });
      const group = await repo.createLensGroup(shopId, { name: "R3-F2 Group" });

      const lens = await repo.createLens(shopId, {
        groupId: group.id,
        name: "Currency Independent Lens",
        priceMinor: 4500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-F2-01",
        shopifyProductId: "gid://shopify/Product/103",
        shopifyVariantId: "gid://shopify/ProductVariant/203",
      });

      // Mock ShopCurrency GraphQL to fail
      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(
            JSON.stringify({ errors: [{ message: "Currency query service down" }] }),
            { status: 200 },
          );
        }
        return originalAdminGraphql?.(query, vars);
      });

      // 1. Archiving from edit page should succeed (does not require currency)
      const archiveReq = new Request(`https://app.test/app/lenses/${lens.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "archive" }),
      });
      const archiveRes = await lensAction(createActionArgs(archiveReq, { id: lens.id }));
      const unwrappedArchive = await unwrapResponse(archiveRes);
      expect(unwrappedArchive.status).toBe(302);

      // Verify lens was archived in DB
      const rawLens = await repo.getLens(shopId, lens.id);
      expect(rawLens?.archivedAt).not.toBeNull();

      // Verify lens is removed from active catalog
      const activeGroups = await service.listLensGroups(shopId, { includeArchived: false });
      expect(activeGroups[0].lenses.some((l) => l.id === lens.id)).toBe(false);

      // 2. Saving on edit page still requires currency and fails with CURRENCY_FETCH_FAILED
      const saveReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "New Lens With Failing Currency",
          price: "50.00",
          sphMin: "-2.00",
          sphMax: "+2.00",
          cylMin: "0.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
          labCodeTemplate: "PO-TEST",
        }),
      });
      const saveRes = await lensAction(createActionArgs(saveReq, { id: "new" }));
      const unwrappedSave = await unwrapResponse<{ error: { code: string } }>(saveRes);
      expect(unwrappedSave.status).toBe(400);
      expect(unwrappedSave.data.error.code).toBe("CURRENCY_FETCH_FAILED");

      if (originalAdminGraphql) {
        mocks.adminGraphql.mockImplementation(originalAdminGraphql);
      }
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

    it("renders list error state with Retry button when loader fails (R1-F7, R2-F5)", async () => {
      // 1. Loader failure path: make loader fail when service throws
      const shopDomain = "loader-error-test.myshopify.com";
      await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const serviceSpy = vi.spyOn(catalogService, "listLensGroups").mockRejectedValueOnce(
        new Error("Failed to load lenses from server"),
      );

      const request = new Request("https://app.test/app/lenses");
      await expect(listLoader(createLoaderArgs(request))).rejects.toThrow(
        "Failed to load lenses from server",
      );
      serviceSpy.mockRestore();

      // 2. Render route ErrorBoundary with the routed error
      vi.spyOn(ReactRouter, "useRouteError").mockReturnValue(
        new Error("Failed to load lenses from server"),
      );

      const { container } = render(<ListErrorBoundary />);

      const banner = container.querySelector(
        's-banner[heading="Failed to load lenses"]',
      );
      expect(banner).not.toBeNull();
      expect(screen.getByText("Failed to load lenses from server")).not.toBeNull();
      const retryBtn = screen.getByText("Retry");
      expect(retryBtn).not.toBeNull();
      expect(retryBtn.getAttribute("href")).toBe("/app/lenses");
    });

    it("renders all four RxType choices including NON_PRESCRIPTION with correct label (R1-F4)", () => {
      const { container } = render(
        <LensForm
          groups={[{ id: "g1", name: "G1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
        />,
      );

      expect(
        container.querySelector('s-checkbox[name="rxTypeSingleVision"][label="Single vision"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('s-checkbox[name="rxTypeProgressive"][label="Progressive"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('s-checkbox[name="rxTypeReading"][label="Reading"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('s-checkbox[name="rxTypeNonPrescription"][label="Non-prescription"]'),
      ).not.toBeNull();
    });

    it("flips checkbox state exactly once per click and does not double-toggle (R1-F3)", () => {
      const { container } = render(
        <LensForm
          groups={[{ id: "g1", name: "G1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
        />,
      );

      const progressiveCheckbox = container.querySelector(
        's-checkbox[name="rxTypeProgressive"]',
      ) as (HTMLElement & { checked: boolean }) | null;
      expect(progressiveCheckbox).not.toBeNull();
      expect(progressiveCheckbox?.checked).toBe(false);

      // Simulate change event to checked
      fireEvent.change(progressiveCheckbox!, { target: { checked: true } });
      expect(progressiveCheckbox?.checked).toBe(true);

      // Simulate both input and change events with checked: false (React 18 scenario)
      fireEvent.input(progressiveCheckbox!, { target: { checked: false } });
      fireEvent.change(progressiveCheckbox!, { target: { checked: false } });
      // Flips to unchecked and does not double-toggle back to checked
      expect(progressiveCheckbox?.checked).toBe(false);
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

      // 1. Test reorder UI controls (R1-F1)
      const service = createCatalogService({ prisma: getTestPrisma() });
      const groupsForRender = await service.listLensGroups(shopId, { includeArchived: false });
      render(<LensesList groups={groupsForRender} />);

      // Click "Move group down" on Group 1
      const moveGroupDownButtons = screen.getAllByText("Move group down");
      fireEvent.click(moveGroupDownButtons[0]);

      expect(mocks.fetcherSubmit).toHaveBeenCalledWith(
        { intent: "reorder-groups", ids: `${g2.id},${g1.id}` },
        { method: "POST" },
      );

      // Click "Move lens down" on Lens 1
      const moveLensDownButtons = screen.getAllByText("Move lens down");
      fireEvent.click(moveLensDownButtons[0]);

      expect(mocks.fetcherSubmit).toHaveBeenCalledWith(
        { intent: "reorder-lenses", groupId: g1.id, ids: `${l2.id},${l1.id}` },
        { method: "POST" },
      );

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

    it("rejects reorder batches whose ids are not exactly the shop's items in that group with 400 and leaves order unchanged (R1-F9)", async () => {
      const shopDomain = "reorder-boundary.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const g = await repo.createLensGroup(shopId, { name: "Boundary Group", position: 0 });
      const l1 = await repo.createLens(shopId, {
        groupId: g.id,
        name: "Lens A",
        priceMinor: 1000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-A",
        position: 0,
      });
      const l2 = await repo.createLens(shopId, {
        groupId: g.id,
        name: "Lens B",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-B",
        position: 1,
      });

      // 1. Duplicate IDs: [l1, l1] -> 400
      const dupReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "reorder-lenses",
          groupId: g.id,
          ids: [l1.id, l1.id],
        }),
      });
      const dupRes = await listAction(createActionArgs(dupReq));
      expect((await unwrapResponse(dupRes)).status).toBe(400);

      // Verify no change
      let lenses = await repo.listLenses(shopId, { groupId: g.id });
      expect(lenses[0].id).toBe(l1.id);
      expect(lenses[1].id).toBe(l2.id);

      // 2. Foreign ID: [l1, 'fake-id'] -> 400
      const foreignReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "reorder-lenses",
          groupId: g.id,
          ids: [l1.id, "nonexistent-id"],
        }),
      });
      const foreignRes = await listAction(createActionArgs(foreignReq));
      expect((await unwrapResponse(foreignRes)).status).toBe(400);

      // Verify no change
      lenses = await repo.listLenses(shopId, { groupId: g.id });
      expect(lenses[0].id).toBe(l1.id);
      expect(lenses[1].id).toBe(l2.id);

      // 3. More than group holds: [l1, l2, extra] -> 400
      const moreReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "reorder-lenses",
          groupId: g.id,
          ids: [l1.id, l2.id, "extra-id"],
        }),
      });
      const moreRes = await listAction(createActionArgs(moreReq));
      expect((await unwrapResponse(moreRes)).status).toBe(400);

      // Verify no change
      lenses = await repo.listLenses(shopId, { groupId: g.id });
      expect(lenses[0].id).toBe(l1.id);
      expect(lenses[1].id).toBe(l2.id);

      // 4. Fewer than group holds: [l1] -> 400
      const fewerReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "reorder-lenses",
          groupId: g.id,
          ids: [l1.id],
        }),
      });
      const fewerRes = await listAction(createActionArgs(fewerReq));
      expect((await unwrapResponse(fewerRes)).status).toBe(400);

      // Verify no change
      lenses = await repo.listLenses(shopId, { groupId: g.id });
      expect(lenses[0].id).toBe(l1.id);
      expect(lenses[1].id).toBe(l2.id);

      // 5. Exactly matching batch succeeds: [l2, l1] -> 200
      const validReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "reorder-lenses",
          groupId: g.id,
          ids: [l2.id, l1.id],
        }),
      });
      const validRes = await listAction(createActionArgs(validReq));
      expect((await unwrapResponse(validRes)).status).toBe(200);

      // Verify order updated
      lenses = await repo.listLenses(shopId, { groupId: g.id });
      expect(lenses[0].id).toBe(l2.id);
      expect(lenses[1].id).toBe(l1.id);
    }, DB_TIMEOUT_MS);

    it("refuses to archive a group that still has active lenses with 409 GROUP_NOT_EMPTY in both routes, makes no cascading Shopify calls, disables or explains the control in the UI, and allows archiving an empty group (R4-F1)", async () => {
      const shopDomain = "archive-group-r4f1.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const groupWithLens = await repo.createLensGroup(shopId, { name: "Non-empty Group" });
      const emptyGroup = await repo.createLensGroup(shopId, { name: "Empty Group" });

      const lens = await repo.createLens(shopId, {
        groupId: groupWithLens.id,
        name: "Active Lens In Group",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "PO-R4F1",
        position: 0,
        shopifyProductId: "gid://shopify/Product/9991",
        shopifyVariantId: "gid://shopify/ProductVariant/9992",
      });

      // Clear any prior mock calls
      mocks.adminGraphql.mockClear();

      // 1. Attempt archive of non-empty group via lenses index action -> 409 GROUP_NOT_EMPTY
      const indexArchiveForm = new FormData();
      indexArchiveForm.append("intent", "archive-group");
      indexArchiveForm.append("groupId", groupWithLens.id);

      const indexArchiveReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: indexArchiveForm,
      });

      const indexArchiveRes = await listAction(createActionArgs(indexArchiveReq));
      const indexUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(indexArchiveRes);
      expect(indexUnwrapped.status).toBe(409);
      expect(indexUnwrapped.data.error.code).toBe("GROUP_NOT_EMPTY");
      expect(indexUnwrapped.data.error.message).toContain("Archive its lenses first");

      // Verify no cascading Shopify calls were made
      expect(mocks.adminGraphql).not.toHaveBeenCalled();

      // Verify group remains active
      const groupAfterIndex = await repo.getLensGroup(shopId, groupWithLens.id);
      expect(groupAfterIndex?.archivedAt).toBeNull();

      // 2. Attempt archive of non-empty group via lens-group route action -> 409 GROUP_NOT_EMPTY
      const groupRouteArchiveForm = new FormData();
      groupRouteArchiveForm.append("intent", "archive");

      const groupRouteArchiveReq = new Request(`https://app.test/app/lens-groups/${groupWithLens.id}`, {
        method: "POST",
        body: groupRouteArchiveForm,
      });

      const groupRouteArchiveRes = await groupAction(
        createActionArgs(groupRouteArchiveReq, { id: groupWithLens.id }),
      );
      const groupRouteUnwrapped = await unwrapResponse<{ error: { code: string; message: string } }>(
        groupRouteArchiveRes,
      );
      expect(groupRouteUnwrapped.status).toBe(409);
      expect(groupRouteUnwrapped.data.error.code).toBe("GROUP_NOT_EMPTY");
      expect(groupRouteUnwrapped.data.error.message).toContain("Archive its lenses first");

      // Verify no cascading Shopify calls
      expect(mocks.adminGraphql).not.toHaveBeenCalled();

      // Verify group still remains active
      const groupAfterGroupRoute = await repo.getLensGroup(shopId, groupWithLens.id);
      expect(groupAfterGroupRoute?.archivedAt).toBeNull();

      // 3. UI checks:
      // a) LensesList UI disables Archive group button and shows explanation for non-empty group
      const service = createCatalogService({ prisma: getTestPrisma() });
      const groupsList = await service.listLensGroups(shopId, { includeArchived: false });
      const { container } = render(<LensesList groups={groupsList} />);

      const nonEmptySection = container.querySelector('s-section[heading="Non-empty Group"]');
      const nonEmptyArchiveBtn = nonEmptySection?.querySelector('s-button[tone="critical"]');
      expect(nonEmptyArchiveBtn?.hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Archive all lenses before archiving this group.")).not.toBeNull();

      // Empty group archive button should NOT be disabled
      const emptySection = container.querySelector('s-section[heading="Empty Group"]');
      const emptyArchiveBtn = emptySection?.querySelector('s-button[tone="critical"]');
      expect(emptyArchiveBtn?.hasAttribute("disabled")).toBe(false);

      cleanup();

      // b) LensGroupEditRoute UI disables Archive button and shows banner for non-empty group
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);
      vi.spyOn(ReactRouter, "useNavigation").mockReturnValue({
        state: "idle",
      } as unknown as ReactRouter.Navigation);
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        isNew: false,
        group: {
          id: groupWithLens.id,
          name: groupWithLens.name,
          description: groupWithLens.description,
          position: 0,
          lenses: [
            {
              id: lens.id,
              groupId: groupWithLens.id,
              name: lens.name,
              price: { amountMinor: 5000, currency: "USD" },
              limits: {
                rxTypes: ["SINGLE_VISION"],
                sphMin: -400,
                sphMax: 400,
                cylMin: -200,
                cylMax: 0,
              },
              labCodeTemplate: "PO-R4F1",
              position: 0,
              archivedAt: null,
            },
          ],
        },
      });

      render(<LensGroupEditRoute />);
      const groupArchiveBtn = screen.getByText("Archive").closest("s-button");
      expect(groupArchiveBtn?.hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Archive all lenses in this group before archiving the group.")).not.toBeNull();

      cleanup();

      // 4. Archiving empty group succeeds in both routes
      // via lens-group route:
      const archiveEmptyGroupForm = new FormData();
      archiveEmptyGroupForm.append("intent", "archive");
      const archiveEmptyReq = new Request(`https://app.test/app/lens-groups/${emptyGroup.id}`, {
        method: "POST",
        body: archiveEmptyGroupForm,
      });
      const archiveEmptyRes = await groupAction(
        createActionArgs(archiveEmptyReq, { id: emptyGroup.id }),
      );
      expect((await unwrapResponse(archiveEmptyRes)).status).toBe(302);

      const archivedEmptyGroup = await repo.getLensGroup(shopId, emptyGroup.id);
      expect(archivedEmptyGroup?.archivedAt).not.toBeNull();

      // via lenses index action for another empty group:
      const emptyGroup2 = await repo.createLensGroup(shopId, { name: "Empty Group 2" });
      const indexArchiveEmptyForm = new FormData();
      indexArchiveEmptyForm.append("intent", "archive-group");
      indexArchiveEmptyForm.append("groupId", emptyGroup2.id);
      const indexArchiveEmptyReq = new Request("https://app.test/app/lenses", {
        method: "POST",
        body: indexArchiveEmptyForm,
      });
      const indexArchiveEmptyRes = await listAction(createActionArgs(indexArchiveEmptyReq));
      const indexEmptyUnwrapped = await unwrapResponse<{ ok: boolean; archivedGroupId: string }>(
        indexArchiveEmptyRes,
      );
      expect(indexEmptyUnwrapped.status).toBe(200);
      expect(indexEmptyUnwrapped.data.ok).toBe(true);
      expect(indexEmptyUnwrapped.data.archivedGroupId).toBe(emptyGroup2.id);

      const archivedEmptyGroup2 = await repo.getLensGroup(shopId, emptyGroup2.id);
      expect(archivedEmptyGroup2?.archivedAt).not.toBeNull();
    }, DB_TIMEOUT_MS);

    it("synchronizes group fields through DOM properties (.value) and updates hidden inputs on typing (R4-F2)", () => {
      vi.spyOn(ReactRouter, "useActionData").mockReturnValue(undefined);
      vi.spyOn(ReactRouter, "useNavigation").mockReturnValue({
        state: "idle",
      } as unknown as ReactRouter.Navigation);
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        isNew: false,
        group: {
          id: "group-sync-1",
          name: "Initial Group Name",
          description: "Initial Description",
          position: 0,
          lenses: [],
        },
      });

      const { container } = render(<LensGroupEditRoute />);

      const nameField = container.querySelector('s-text-field[name="nameField"]') as
        | (HTMLElement & { value: string })
        | null;
      const descField = container.querySelector('s-text-area[name="descriptionField"]') as
        | (HTMLElement & { value: string })
        | null;
      const nameHidden = container.querySelector('input[name="name"]') as HTMLInputElement | null;
      const descHidden = container.querySelector('input[name="description"]') as HTMLInputElement | null;

      expect(nameField).not.toBeNull();
      expect(descField).not.toBeNull();
      expect(nameHidden).not.toBeNull();
      expect(descHidden).not.toBeNull();

      // Initial DOM properties synchronized under React 18
      expect(nameField?.value).toBe("Initial Group Name");
      expect(descField?.value).toBe("Initial Description");
      expect(nameHidden?.value).toBe("Initial Group Name");
      expect(descHidden?.value).toBe("Initial Description");

      // Typing into name updates DOM property and hidden input
      nameField!.value = "Updated Name";
      fireEvent(nameField!, new Event("input", { bubbles: true }));
      fireEvent(nameField!, new Event("change", { bubbles: true }));

      expect(nameField?.value).toBe("Updated Name");
      expect(nameHidden?.value).toBe("Updated Name");

      // Typing into description updates DOM property and hidden input
      descField!.value = "Updated Desc";
      fireEvent(descField!, new Event("input", { bubbles: true }));
      fireEvent(descField!, new Event("change", { bubbles: true }));

      expect(descField?.value).toBe("Updated Desc");
      expect(descHidden?.value).toBe("Updated Desc");

      cleanup();
    });

    it("starts new lenses with an empty price field without MONEY_PRECISION, and saves lenses for zero-decimal currency shops like JPY (R4-F3)", async () => {
      // 1. Component test: LensForm starts with empty price and Save disabled, no MONEY_PRECISION error
      const { container } = render(
        <LensForm
          groups={[{ id: "g-jpy", name: "JPY Group", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g-jpy"
          shopCurrency="JPY"
        />,
      );

      const priceField = container.querySelector('s-text-field[name="priceField"]') as
        | (HTMLElement & { value: string })
        | null;
      expect(priceField).not.toBeNull();
      expect(priceField?.value).toBe("");
      expect(screen.queryByText("MONEY_PRECISION")).toBeNull();

      // Save button is disabled because price is empty
      const saveButton = screen.getByText("Save").closest("s-button");
      expect(saveButton?.hasAttribute("disabled")).toBe(true);

      cleanup();

      // 2. Action test: save lens for JPY shop
      const shopDomain = "jpy-shop.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Tokyo Optics" });

      // Mock ShopCurrency to return JPY
      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(
            JSON.stringify({ data: { shop: { currencyCode: "JPY" } } }),
            { status: 200 },
          );
        }
        return originalAdminGraphql ? originalAdminGraphql(query, vars) : new Response("{}", { status: 200 });
      });

      // Saving with empty price should be rejected (required on save)
      const emptyPriceReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          groupId: group.id,
          name: "Empty Price Lens",
          price: "",
          sphMin: "-4.00",
          sphMax: "+4.00",
          cylMin: "-2.00",
          cylMax: "0.00",
          rxTypes: ["SINGLE_VISION"],
        }),
      });
      const emptyPriceRes = await lensAction(createActionArgs(emptyPriceReq, { id: "new" }));
      const emptyPriceUnwrapped = await unwrapResponse<{ error: { code: string; message: string; fields?: unknown[] } }>(emptyPriceRes);
      expect(emptyPriceUnwrapped.status).toBe(400);
      expect(emptyPriceUnwrapped.data.error.code).toBe("MONEY_FORMAT");

      // Saving with valid JPY price (e.g. 5000 yen) succeeds
      const jpySaveForm = new FormData();
      jpySaveForm.append("intent", "save");
      jpySaveForm.append("groupId", group.id);
      jpySaveForm.append("name", "Standard JPY Lens");
      jpySaveForm.append("price", "5000");
      jpySaveForm.append("sphMin", "-4.00");
      jpySaveForm.append("sphMax", "+4.00");
      jpySaveForm.append("cylMin", "-2.00");
      jpySaveForm.append("cylMax", "0.00");
      jpySaveForm.append("rxTypes", "SINGLE_VISION");
      jpySaveForm.append("labCodeTemplate", "PO-58-NONE-NONE-00");

      const jpySaveReq = new Request("https://app.test/app/lenses/new", {
        method: "POST",
        body: jpySaveForm,
      });

      const jpySaveRes = await lensAction(createActionArgs(jpySaveReq, { id: "new" }));
      const jpySaveUnwrapped = await unwrapResponse(jpySaveRes);
      expect(jpySaveUnwrapped.status).toBe(302);

      // Verify lens was saved with JPY currency and 5000 minor units
      const lenses = await repo.listLenses(shopId, { groupId: group.id });
      expect(lenses.length).toBe(1);
      expect(lenses[0].currency).toBe("JPY");
      expect(lenses[0].priceMinor).toBe(5000);

      // Verify variant update in Shopify was called with price "5000"
      const variantCalls = mocks.adminGraphql.mock.calls.filter((call) =>
        String(call[0]).includes("productVariantsBulkUpdate"),
      );
      expect(variantCalls.length).toBeGreaterThan(0);
      const lastVariantCall = variantCalls[variantCalls.length - 1];
      expect(lastVariantCall[1]?.variables?.variants?.[0]?.price).toBe("5000");

      if (originalAdminGraphql) {
        mocks.adminGraphql.mockImplementation(originalAdminGraphql);
      }
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

  describe("Review Round 6 findings (R6-F1, R6-F2, R6-F4, R6-F5)", () => {
    it("submits lens form through the router and renders action error inline (R6-F1)", async () => {
      vi.spyOn(ReactRouter, "useFetcher").mockImplementation(actualUseFetcher);

      const router = ReactRouter.createMemoryRouter(
        [
          {
            path: "/app/lenses/new",
            Component: () => (
              <LensForm
                groups={[{ id: "group-1", name: "Standard", position: 0, lenses: [], archivedAt: null }]}
                defaultGroupId="group-1"
                defaultValues={{
                  name: "Valid Name",
                  price: "49.99",
                  sphMin: "-2.00",
                  sphMax: "+2.00",
                  cylMin: "-1.00",
                  cylMax: "0.00",
                }}
              />
            ),
            action: async () => {
              return ReactRouter.data(
                {
                  error: {
                    code: "CUSTOM_SAVE_REJECTED",
                    message: "Server rejected the save submission",
                  },
                },
                { status: 400 },
              );
            },
          },
        ],
        { initialEntries: ["/app/lenses/new"] },
      );

      render(<ReactRouter.RouterProvider router={router} />);

      // Save button is enabled
      const saveBtn = screen.getByText("Save").closest("s-button") ?? screen.getByText("Save");
      expect(saveBtn.hasAttribute("disabled")).toBe(false);

      // Click Save to trigger form submit through fetcher.Form
      fireEvent.click(saveBtn);

      // Verify inline error banner is rendered with the action error message
      const errorMessage = await screen.findByText("Server rejected the save submission");
      expect(errorMessage).not.toBeNull();
      const banner = errorMessage.closest("s-banner");
      expect(banner?.getAttribute("heading")).toBe("Save failed");
      expect(banner?.getAttribute("tone")).toBe("critical");
    });

    it("submits lens group form through the router and renders action error inline, and uses fetcher.submit for archive (R6-F1)", async () => {
      vi.spyOn(ReactRouter, "useFetcher").mockImplementation(actualUseFetcher);

      let actionCalled = false;
      let submittedIntent: string | null = null;

      const router = ReactRouter.createMemoryRouter(
        [
          {
            path: "/app/lens-groups/new",
            HydrateFallback: () => null,
            Component: LensGroupEditRoute,
            loader: () => ({
              group: null,
              isNew: true,
            }),
            action: async ({ request }) => {
              actionCalled = true;
              const formData = await request.formData();
              submittedIntent = formData.get("intent") as string;
              return ReactRouter.data(
                {
                  error: {
                    code: "NAME_REQUIRED",
                    message: "Group name is required",
                  },
                },
                { status: 400 },
              );
            },
          },
        ],
        { initialEntries: ["/app/lens-groups/new"] },
      );

      render(<ReactRouter.RouterProvider router={router} />);

      const saveBtn = await screen.findByText("Save");
      const saveBtnElement = saveBtn.closest("s-button") ?? saveBtn;
      // Type a name to enable Save
      const nameField = document.querySelector('s-text-field[name="nameField"]') as
        | (HTMLElement & { value: string })
        | null;
      if (nameField) {
        nameField.value = "Test Group";
        fireEvent(nameField, new Event("input", { bubbles: true }));
        fireEvent(nameField, new Event("change", { bubbles: true }));
      }

      fireEvent.click(saveBtnElement);

      const errorMessage = await screen.findByText("Group name is required");
      expect(errorMessage).not.toBeNull();
      const banner = errorMessage.closest("s-banner");
      expect(banner?.getAttribute("heading")).toBe("Error");
      expect(banner?.getAttribute("tone")).toBe("critical");
      expect(actionCalled).toBe(true);
      expect(submittedIntent).toBe("save");
    });

    it("ensures valid form Save button and non-boundary Move buttons have no disabled attribute under React 18 (R6-F2)", () => {
      // 1. LensForm with valid inputs has no disabled attribute on Save
      const { unmount: unmountLens } = render(
        <LensForm
          groups={[{ id: "g1", name: "Group 1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
          defaultValues={{
            name: "Premium Lens",
            price: "50.00",
            sphMin: "-4.00",
            sphMax: "+4.00",
            cylMin: "-2.00",
            cylMax: "0.00",
          }}
        />,
      );

      const lensSaveBtn = screen.getByText("Save").closest("s-button");
      expect(lensSaveBtn).not.toBeNull();
      expect(lensSaveBtn?.hasAttribute("disabled")).toBe(false);
      expect(lensSaveBtn?.getAttribute("disabled")).toBeNull();

      unmountLens();

      // 2. LensGroupEditRoute with non-empty name has no disabled attribute on Save
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        group: { id: "g1", name: "Valid Group", description: "", position: 0, lenses: [] },
        isNew: false,
      });

      const { unmount: unmountGroup } = render(<LensGroupEditRoute />);
      const groupSaveBtn = screen.getByText("Save").closest("s-button");
      expect(groupSaveBtn).not.toBeNull();
      expect(groupSaveBtn?.hasAttribute("disabled")).toBe(false);
      expect(groupSaveBtn?.getAttribute("disabled")).toBeNull();

      unmountGroup();

      // 3. Move buttons on middle item in LensesList have no disabled attribute
      const middleGroupLenses = [
        {
          id: "l1",
          groupId: "g1",
          name: "Lens 1",
          price: { amountMinor: 1000, currency: "USD" },
          limits: { rxTypes: ["SINGLE_VISION" as const], sphMin: -200, sphMax: 200, cylMin: 0, cylMax: 0 },
          labCodeTemplate: "PO-1",
          shopifyProductId: null,
          shopifyVariantId: null,
          position: 0,
          archivedAt: null,
        },
        {
          id: "l2",
          groupId: "g1",
          name: "Lens 2",
          price: { amountMinor: 2000, currency: "USD" },
          limits: { rxTypes: ["SINGLE_VISION" as const], sphMin: -200, sphMax: 200, cylMin: 0, cylMax: 0 },
          labCodeTemplate: "PO-2",
          shopifyProductId: null,
          shopifyVariantId: null,
          position: 1,
          archivedAt: null,
        },
        {
          id: "l3",
          groupId: "g1",
          name: "Lens 3",
          price: { amountMinor: 3000, currency: "USD" },
          limits: { rxTypes: ["SINGLE_VISION" as const], sphMin: -200, sphMax: 200, cylMin: 0, cylMax: 0 },
          labCodeTemplate: "PO-3",
          shopifyProductId: null,
          shopifyVariantId: null,
          position: 2,
          archivedAt: null,
        },
      ];
      const threeGroups = [
        { id: "g1", name: "Group 1", position: 0, lenses: middleGroupLenses, archivedAt: null },
        { id: "g2", name: "Group 2", position: 1, lenses: [], archivedAt: null },
        { id: "g3", name: "Group 3", position: 2, lenses: [], archivedAt: null },
      ];

      const { container } = render(<LensesList groups={threeGroups} />);

      // Middle group (g2) Move up and Move down buttons are not disabled
      const g2Section = container.querySelector('s-section[heading="Group 2"]');
      const g2MoveUp = Array.from(g2Section?.querySelectorAll("s-button") ?? []).find(
        (b) => b.textContent?.includes("Move group up"),
      );
      const g2MoveDown = Array.from(g2Section?.querySelectorAll("s-button") ?? []).find(
        (b) => b.textContent?.includes("Move group down"),
      );
      expect(g2MoveUp?.hasAttribute("disabled")).toBe(false);
      expect(g2MoveDown?.hasAttribute("disabled")).toBe(false);

      // Middle lens (l2) Move up and Move down buttons are not disabled
      const l2Box = Array.from(container.querySelectorAll("s-box")).find((box) =>
        box.textContent?.includes("Lens 2"),
      );
      const l2MoveUp = Array.from(l2Box?.querySelectorAll("s-button") ?? []).find(
        (b) => b.textContent?.includes("Move lens up"),
      );
      const l2MoveDown = Array.from(l2Box?.querySelectorAll("s-button") ?? []).find(
        (b) => b.textContent?.includes("Move lens down"),
      );
      expect(l2MoveUp?.hasAttribute("disabled")).toBe(false);
      expect(l2MoveDown?.hasAttribute("disabled")).toBe(false);

      cleanup();
    });

    it("disables the last remaining Rx type checkbox and prevents unchecking it in UI and form submission (R6-F4)", () => {
      const { container } = render(
        <LensForm
          groups={[{ id: "g1", name: "Group 1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
        />,
      );

      // By default, only SINGLE_VISION is checked
      const singleVisionBox = container.querySelector(
        's-checkbox[name="rxTypeSingleVision"]',
      ) as (HTMLElement & { checked: boolean }) | null;
      const progressiveBox = container.querySelector(
        's-checkbox[name="rxTypeProgressive"]',
      ) as (HTMLElement & { checked: boolean }) | null;

      expect(singleVisionBox).not.toBeNull();
      expect(progressiveBox).not.toBeNull();

      // Because SINGLE_VISION is the only selected Rx type, it must be disabled
      expect(singleVisionBox?.hasAttribute("disabled")).toBe(true);
      expect(progressiveBox?.hasAttribute("disabled")).toBe(false);

      // Attempting to uncheck the last remaining checkbox keeps it checked
      fireEvent(singleVisionBox!, new Event("change", { bubbles: true }));
      expect(singleVisionBox?.checked).toBe(true);

      const hiddenRxTypes = container.querySelectorAll('input[name="rxTypes"]');
      expect(hiddenRxTypes.length).toBe(1);
      expect((hiddenRxTypes[0] as HTMLInputElement).value).toBe("SINGLE_VISION");

      // Check PROGRESSIVE as a second type
      progressiveBox!.checked = true;
      fireEvent(progressiveBox!, new Event("change", { bubbles: true }));

      // Now that 2 types are checked, neither is disabled
      expect(singleVisionBox?.hasAttribute("disabled")).toBe(false);
      expect(progressiveBox?.hasAttribute("disabled")).toBe(false);

      cleanup();
    });

    it("starts a new lens with empty ADD limits and shows ADD fields only when PROGRESSIVE or READING is selected (R6-F5)", () => {
      const { container } = render(
        <LensForm
          groups={[{ id: "g1", name: "Group 1", position: 0, lenses: [], archivedAt: null }]}
          defaultGroupId="g1"
        />,
      );

      // Default single-vision lens has no ADD fields rendered
      expect(container.querySelector('s-text-field[name="addMinField"]')).toBeNull();
      expect(container.querySelector('s-text-field[name="addMaxField"]')).toBeNull();

      // Hidden inputs for addMin and addMax must be empty
      const hiddenAddMin = container.querySelector('input[name="addMin"]') as HTMLInputElement | null;
      const hiddenAddMax = container.querySelector('input[name="addMax"]') as HTMLInputElement | null;
      expect(hiddenAddMin?.value).toBe("");
      expect(hiddenAddMax?.value).toBe("");

      // SPH and CYL defaults are preserved (type-neutral)
      const hiddenSphMin = container.querySelector('input[name="sphMin"]') as HTMLInputElement | null;
      const hiddenSphMax = container.querySelector('input[name="sphMax"]') as HTMLInputElement | null;
      expect(hiddenSphMin?.value).toBe("-8.00");
      expect(hiddenSphMax?.value).toBe("+6.00");

      // Check PROGRESSIVE -> ADD fields appear
      const progressiveBox = container.querySelector(
        's-checkbox[name="rxTypeProgressive"]',
      ) as (HTMLElement & { checked: boolean }) | null;
      progressiveBox!.checked = true;
      fireEvent(progressiveBox!, new Event("change", { bubbles: true }));

      expect(container.querySelector('s-text-field[name="addMinField"]')).not.toBeNull();
      expect(container.querySelector('s-text-field[name="addMaxField"]')).not.toBeNull();

      cleanup();
    });
  });

  describe("Review Round 7 findings (R7-F1, R7-F2)", () => {
    it("handles currency mismatch when a lens stored in USD is edited on a shop now in EUR (R7-F1)", async () => {
      // 1. Component test: LensForm displays EUR label & details, shows warning banner, leaves price empty, disables Save
      const usdLens: CatalogLensDto = {
        id: "lens-usd-1",
        groupId: "g1",
        name: "Classic Bifocal",
        description: "Old USD lens",
        price: { amountMinor: 4999, currency: "USD" },
        limits: {
          rxTypes: ["SINGLE_VISION"],
          sphMin: -400,
          sphMax: 400,
          cylMin: -200,
          cylMax: 0,
        },
        labCodeTemplate: "PO-1",
        shopifyProductId: null,
        shopifyVariantId: null,
        position: 0,
        archivedAt: null,
      };

      const { container } = render(
        <LensForm
          lens={usdLens}
          groups={[{ id: "g1", name: "Standard", position: 0, lenses: [], archivedAt: null }]}
          shopCurrency="EUR"
        />,
      );

      // Warning banner is rendered
      const warningBanner = container.querySelector('s-banner[tone="warning"]');
      expect(warningBanner).not.toBeNull();
      expect(warningBanner?.getAttribute("heading")).toBe("Currency mismatch");
      expect(warningBanner?.textContent).toContain("This lens was stored in USD");
      expect(warningBanner?.textContent).toContain("your shop currency is now EUR");
      expect(warningBanner?.textContent).toContain("The price will be saved in EUR");

      // Price field uses EUR for label and details
      const priceField = container.querySelector('s-text-field[name="priceField"]') as
        | (HTMLElement & { value: string })
        | null;
      expect(priceField).not.toBeNull();
      expect(priceField?.getAttribute("label")).toBe("Price (EUR)");
      expect(priceField?.getAttribute("details")).toContain("EUR");
      expect(priceField?.getAttribute("details")).not.toContain("USD");

      // Price is empty: old amount was NOT reformatted silently
      expect(priceField?.value).toBe("");

      // Save button is disabled because price is required
      const saveBtn = screen.getByText("Save").closest("s-button");
      expect(saveBtn?.hasAttribute("disabled")).toBe(true);

      // Entering a valid EUR price enables Save
      priceField!.value = "45.00";
      fireEvent(priceField!, new Event("input", { bubbles: true }));
      fireEvent(priceField!, new Event("change", { bubbles: true }));
      expect(saveBtn?.hasAttribute("disabled")).toBe(false);

      cleanup();

      // 2. Full action/loader roundtrip: lens stored in USD on a shop now in EUR saves with EUR and fresh price
      const shopDomain = "eur-shop.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const originalAdminGraphql = mocks.adminGraphql.getMockImplementation();
      mocks.adminGraphql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
        if (query.includes("ShopCurrency")) {
          return new Response(JSON.stringify({ data: { shop: { currencyCode: "EUR" } } }), { status: 200 });
        }
        return originalAdminGraphql ? originalAdminGraphql(query, vars) : new Response("{}", { status: 200 });
      });

      try {
        const repo = createCatalogRepository(getTestPrisma());
        const group = await repo.createLensGroup(shopId, { name: "Europe Group" });
        const initialLens = await repo.createLens(shopId, {
          groupId: group.id,
          name: "Old USD Lens",
          priceMinor: 5000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        });

        // Load lens with loader: shopCurrency is EUR, lens stored in USD
        const loadReq = new Request(`https://app.test/app/lenses/${initialLens.id}`);
        const loadRes = await lensLoader(createLoaderArgs(loadReq, { id: initialLens.id }));
        const loadedData = (await unwrapResponse<{ lens: CatalogLensDto; shopCurrency: string }>(loadRes)).data;
        expect(loadedData.shopCurrency).toBe("EUR");
        expect(loadedData.lens.price.currency).toBe("USD");

        // Submit edit form with fresh EUR price "45.00"
        const editForm = new FormData();
        editForm.append("intent", "save");
        editForm.append("groupId", group.id);
        editForm.append("name", "Updated EUR Lens");
        editForm.append("price", "45.00");
        editForm.append("currency", "EUR");
        editForm.append("sphMin", "-2.00");
        editForm.append("sphMax", "+2.00");
        editForm.append("cylMin", "-1.00");
        editForm.append("cylMax", "0.00");
        editForm.append("rxTypes", "SINGLE_VISION");
        editForm.append("labCodeTemplate", "PO-1");

        const editReq = new Request(`https://app.test/app/lenses/${initialLens.id}`, {
          method: "POST",
          body: editForm,
        });
        const editRes = await lensAction(createActionArgs(editReq, { id: initialLens.id }));
        const editUnwrapped = await unwrapResponse(editRes);
        expect(editUnwrapped.status).toBe(302);

        // Reload lens from database: currency is now EUR, priceMinor is 4500
        const reloaded = await repo.getLens(shopId, initialLens.id);
        expect(reloaded?.currency).toBe("EUR");
        expect(reloaded?.priceMinor).toBe(4500);

        // Render reloaded lens in form: no warning banner, price is 45.00, label is Price (EUR)
        const reloadedRes = await lensLoader(createLoaderArgs(loadReq, { id: initialLens.id }));
        const reloadedData = (await unwrapResponse<{ lens: CatalogLensDto; groups: CatalogLensGroupDto[]; shopCurrency: string }>(reloadedRes)).data;
        expect(reloadedData.lens.price.currency).toBe("EUR");

        const { container: reloadedContainer } = render(
          <LensForm
            lens={reloadedData.lens}
            groups={reloadedData.groups}
            shopCurrency={reloadedData.shopCurrency}
          />,
        );

        expect(reloadedContainer.querySelector('s-banner[tone="warning"]')).toBeNull();
        const reloadedPriceField = reloadedContainer.querySelector('s-text-field[name="priceField"]') as
          | (HTMLElement & { value: string })
          | null;
        expect(reloadedPriceField?.value).toBe("45.00");
        expect(reloadedPriceField?.getAttribute("label")).toBe("Price (EUR)");
        cleanup();
      } finally {
        if (originalAdminGraphql) {
          mocks.adminGraphql.mockImplementation(originalAdminGraphql);
        }
      }
    }, DB_TIMEOUT_MS);

    it("clearing ADD fields or removing PROGRESSIVE/READING saves addMin and addMax as null, and reload shows empty (R7-F2)", async () => {
      const shopDomain = "r7-add-test.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const repo = createCatalogRepository(getTestPrisma());
      const group = await repo.createLensGroup(shopId, { name: "Multifocal Group" });

      // 1. Create a lens with ADD limits: +1.00 to +2.50
      const initialLens = await repo.createLens(shopId, {
        groupId: group.id,
        name: "Progressive Plus",
        priceMinor: 8000,
        currency: "USD",
        rxTypes: ["PROGRESSIVE"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        addMin: 100,
        addMax: 250,
      });

      // Verify loader returns the initial ADD limits
      const loadReq = new Request(`https://app.test/app/lenses/${initialLens.id}`);
      const initialLoad = await lensLoader(createLoaderArgs(loadReq, { id: initialLens.id }));
      const initialData = (await unwrapResponse<{ lens: CatalogLensDto }>(initialLoad)).data;
      expect(initialData.lens.limits.addMin).toBe(100);
      expect(initialData.lens.limits.addMax).toBe(250);

      // 2. Edit lens and clear ADD fields (blank them out) while keeping PROGRESSIVE
      const clearForm = new FormData();
      clearForm.append("intent", "save");
      clearForm.append("groupId", group.id);
      clearForm.append("name", "Progressive Plus");
      clearForm.append("price", "80.00");
      clearForm.append("sphMin", "-4.00");
      clearForm.append("sphMax", "+4.00");
      clearForm.append("cylMin", "-2.00");
      clearForm.append("cylMax", "0.00");
      clearForm.append("addMin", "");
      clearForm.append("addMax", "");
      clearForm.append("rxTypes", "PROGRESSIVE");
      clearForm.append("labCodeTemplate", "PO-1");

      const clearReq = new Request(`https://app.test/app/lenses/${initialLens.id}`, {
        method: "POST",
        body: clearForm,
      });
      const clearRes = await lensAction(createActionArgs(clearReq, { id: initialLens.id }));
      const clearUnwrapped = await unwrapResponse(clearRes);
      expect(clearUnwrapped.status).toBe(302);

      // Verify database row has addMin and addMax set to null
      const rawAfterClear = await repo.getLens(shopId, initialLens.id);
      expect(rawAfterClear?.addMin).toBeNull();
      expect(rawAfterClear?.addMax).toBeNull();

      // Reload via lensLoader: reload shows empty ADD limits
      const reloadedRes = await lensLoader(createLoaderArgs(loadReq, { id: initialLens.id }));
      const reloadedData = (await unwrapResponse<{ lens: CatalogLensDto; groups: CatalogLensGroupDto[]; shopCurrency: string }>(reloadedRes)).data;
      expect(reloadedData.lens.limits.addMin).toBeUndefined();
      expect(reloadedData.lens.limits.addMax).toBeUndefined();

      // Render reloaded lens in LensForm: ADD fields are rendered (since PROGRESSIVE) and are empty
      const { container } = render(
        <LensForm
          lens={reloadedData.lens}
          groups={reloadedData.groups}
          shopCurrency={reloadedData.shopCurrency}
        />,
      );

      const addMinField = container.querySelector('s-text-field[name="addMinField"]') as
        | (HTMLElement & { value: string })
        | null;
      const addMaxField = container.querySelector('s-text-field[name="addMaxField"]') as
        | (HTMLElement & { value: string })
        | null;
      expect(addMinField?.value).toBe("");
      expect(addMaxField?.value).toBe("");

      cleanup();

      // 3. Set ADD limits again, then switch rxTypes to SINGLE_VISION (no PROGRESSIVE/READING)
      await repo.updateLens(shopId, initialLens.id, {
        addMin: 125,
        addMax: 200,
        rxTypes: ["PROGRESSIVE"],
      });

      const singleVisionForm = new FormData();
      singleVisionForm.append("intent", "save");
      singleVisionForm.append("groupId", group.id);
      singleVisionForm.append("name", "Now Single Vision");
      singleVisionForm.append("price", "80.00");
      singleVisionForm.append("sphMin", "-4.00");
      singleVisionForm.append("sphMax", "+4.00");
      singleVisionForm.append("cylMin", "-2.00");
      singleVisionForm.append("cylMax", "0.00");
      singleVisionForm.append("addMin", "");
      singleVisionForm.append("addMax", "");
      singleVisionForm.append("rxTypes", "SINGLE_VISION");
      singleVisionForm.append("labCodeTemplate", "PO-1");

      const svReq = new Request(`https://app.test/app/lenses/${initialLens.id}`, {
        method: "POST",
        body: singleVisionForm,
      });
      const svRes = await lensAction(createActionArgs(svReq, { id: initialLens.id }));
      expect((await unwrapResponse(svRes)).status).toBe(302);

      // Verify database row has addMin and addMax cleared to null
      const rawAfterSv = await repo.getLens(shopId, initialLens.id);
      expect(rawAfterSv?.addMin).toBeNull();
      expect(rawAfterSv?.addMax).toBeNull();

      // Reload via lensLoader: reload shows empty ADD limits and no ADD fields rendered
      const svReloadRes = await lensLoader(createLoaderArgs(loadReq, { id: initialLens.id }));
      const svReloadData = (await unwrapResponse<{ lens: CatalogLensDto; groups: CatalogLensGroupDto[]; shopCurrency: string }>(svReloadRes)).data;
      expect(svReloadData.lens.limits.addMin).toBeUndefined();
      expect(svReloadData.lens.limits.addMax).toBeUndefined();

      const { container: svContainer } = render(
        <LensForm
          lens={svReloadData.lens}
          groups={svReloadData.groups}
          shopCurrency={svReloadData.shopCurrency}
        />,
      );

      // When only SINGLE_VISION is chosen, ADD fields are not rendered and hidden inputs are empty
      expect(svContainer.querySelector('s-text-field[name="addMinField"]')).toBeNull();
      expect(svContainer.querySelector('s-text-field[name="addMaxField"]')).toBeNull();
      const hiddenAddMin = svContainer.querySelector('input[name="addMin"]') as HTMLInputElement | null;
      const hiddenAddMax = svContainer.querySelector('input[name="addMax"]') as HTMLInputElement | null;
      expect(hiddenAddMin?.value).toBe("");
      expect(hiddenAddMax?.value).toBe("");

      cleanup();
    }, DB_TIMEOUT_MS);
  });
});
