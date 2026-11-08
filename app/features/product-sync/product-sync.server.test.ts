import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { BadRequestError, NotFoundError } from "../../shared/http/errors.server";
import {
  createCatalogService,
  type CatalogService,
} from "../catalog/catalog.service.server";
import { SyncError } from "./errors";
import { archiveItem, syncItem } from "./product-sync.server";
import type { ProductSyncAdminClient, SyncEntity } from "./types";

interface ProductCreateVariables {
  product?: {
    title?: string;
    vendor?: string;
    tags?: string[];
    status?: string;
    metafields?: Array<{
      namespace: string;
      key: string;
      value: string;
      type: string;
    }>;
  };
}

interface ProductVariantsBulkUpdateVariables {
  productId?: string;
  variants?: Array<{
    id?: string;
    price?: string;
    inventoryItem?: {
      tracked?: boolean;
    };
  }>;
}

interface ProductUpdateVariables {
  product?: {
    id?: string;
    title?: string;
    vendor?: string;
    tags?: string[];
    status?: string;
    metafields?: Array<{
      namespace: string;
      key: string;
      value: string;
      type: string;
    }>;
  };
}

export interface FakeProductRecord {
  id: string;
  title: string;
  vendor?: string;
  tags?: string[];
  status?: string;
  metafields?: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
}

interface FakeAdminOptions {
  shopCurrency?: string;
  products?: Map<string, FakeProductRecord>;
  createProductUserErrors?: Array<{ field?: string[]; message: string }>;
  variantBulkUpdateUserErrors?: Array<{ field?: string[]; message: string }>;
  publishUserErrors?: Array<{ field?: string[]; message: string }>;
  productUpdateUserErrors?: Array<{ field?: string[]; message: string }>;
  productDeleteUserErrors?: Array<{ field?: string[]; message: string }>;
  productDeleteDeletedId?: string | null;
  topLevelErrors?: Array<{ message: string }>;
  publicationsPages?: Array<{
    nodes: Array<{ id: string; name: string }>;
    pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
  }>;
  customHandler?: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Response | undefined;
}

function createFakeAdminClient(options: FakeAdminOptions = {}) {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const shopCurrency = options.shopCurrency ?? "USD";
  const products = options.products ?? new Map<string, FakeProductRecord>();

  let createdProductCounter = 1;
  let createdVariantCounter = 10;

  const graphql = vi.fn(async (query: string, init?: { variables?: Record<string, unknown> }) => {
    calls.push({ query, variables: init?.variables });

    if (options.customHandler) {
      const customRes = options.customHandler(query, init?.variables);
      if (customRes) return customRes;
    }

    if (options.topLevelErrors && options.topLevelErrors.length > 0) {
      return new Response(
        JSON.stringify({
          errors: options.topLevelErrors,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 1. Shop currency
    if (query.includes("ShopCurrency")) {
      return new Response(
        JSON.stringify({
          data: {
            shop: {
              currencyCode: shopCurrency,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Publications
    if (query.includes("GetPublications")) {
      if (options.publicationsPages && options.publicationsPages.length > 0) {
        const after = init?.variables?.after as string | undefined;
        let page;
        if (!after) {
          page = options.publicationsPages[0];
        } else {
          const prevIdx = options.publicationsPages.findIndex(
            (p) => p.pageInfo?.endCursor === after,
          );
          page =
            prevIdx >= 0 && prevIdx + 1 < options.publicationsPages.length
              ? options.publicationsPages[prevIdx + 1]
              : undefined;
        }

        return new Response(
          JSON.stringify({
            data: {
              publications: page ?? {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            publications: {
              nodes: [
                {
                  id: "gid://shopify/Publication/999",
                  name: "Online Store",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Variant product lookup
    if (query.includes("GetVariantProduct")) {
      const variantId = (init?.variables?.id as string) ?? "gid://shopify/ProductVariant/unknown";
      return new Response(
        JSON.stringify({
          data: {
            productVariant: {
              id: variantId,
              product: {
                id: "gid://shopify/Product/derived-from-variant",
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 4. Product create
    if (query.includes("ProductCreate")) {
      const vars = (init?.variables ?? {}) as ProductCreateVariables;
      const invalidMetafield = vars.product?.metafields?.find((m) => m.type === "integer");
      if (invalidMetafield) {
        return new Response(
          JSON.stringify({
            data: {
              productCreate: {
                product: null,
                userErrors: [
                  {
                    field: ["product", "metafields", "0", "type"],
                    message: "Type integer is invalid; use number_integer",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (options.createProductUserErrors && options.createProductUserErrors.length > 0) {
        return new Response(
          JSON.stringify({
            data: {
              productCreate: {
                product: null,
                userErrors: options.createProductUserErrors,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const pId = `gid://shopify/Product/${createdProductCounter++}`;
      const vId = `gid://shopify/ProductVariant/${createdVariantCounter++}`;
      const record: FakeProductRecord = {
        id: pId,
        title: vars.product?.title ?? "Test Title",
        vendor: vars.product?.vendor,
        tags: vars.product?.tags ? [...vars.product.tags] : [],
        status: vars.product?.status ?? "ACTIVE",
        metafields: vars.product?.metafields ? [...vars.product.metafields] : [],
      };
      products.set(pId, record);

      return new Response(
        JSON.stringify({
          data: {
            productCreate: {
              product: {
                id: pId,
                title: record.title,
                status: record.status,
                variants: {
                  nodes: [{ id: vId, price: "0.00" }],
                },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 5. Product variants bulk update
    if (query.includes("ProductVariantsBulkUpdate")) {
      if (options.variantBulkUpdateUserErrors && options.variantBulkUpdateUserErrors.length > 0) {
        return new Response(
          JSON.stringify({
            data: {
              productVariantsBulkUpdate: {
                productVariants: [],
                userErrors: options.variantBulkUpdateUserErrors,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const vars = (init?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      const variants = vars.variants ?? [];
      return new Response(
        JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: variants.map((v) => ({
                id: v.id ?? "gid://shopify/ProductVariant/unknown",
                price: v.price ?? "0.00",
              })),
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 6. Publishable publish
    if (query.includes("PublishablePublish")) {
      if (options.publishUserErrors && options.publishUserErrors.length > 0) {
        return new Response(
          JSON.stringify({
            data: {
              publishablePublish: {
                userErrors: options.publishUserErrors,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            publishablePublish: {
              publishable: {
                availablePublicationsCount: { count: 1 },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 7. Product update (archive to draft or convergence update)
    if (query.includes("ProductUpdate")) {
      const vars = (init?.variables ?? {}) as ProductUpdateVariables;
      const invalidMetafield = vars.product?.metafields?.find((m) => m.type === "integer");
      if (invalidMetafield) {
        return new Response(
          JSON.stringify({
            data: {
              productUpdate: {
                product: null,
                userErrors: [
                  {
                    field: ["product", "metafields", "0", "type"],
                    message: "Type integer is invalid; use number_integer",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (options.productUpdateUserErrors && options.productUpdateUserErrors.length > 0) {
        return new Response(
          JSON.stringify({
            data: {
              productUpdate: {
                product: null,
                userErrors: options.productUpdateUserErrors,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const pId = vars.product?.id ?? "gid://shopify/Product/1";
      const existing = products.get(pId);
      if (existing) {
        if (vars.product?.title !== undefined) existing.title = vars.product.title;
        if (vars.product?.vendor !== undefined) existing.vendor = vars.product.vendor;
        if (vars.product?.tags !== undefined) existing.tags = [...vars.product.tags];
        if (vars.product?.status !== undefined) existing.status = vars.product.status;
        if (vars.product?.metafields !== undefined) existing.metafields = [...vars.product.metafields];
      }

      return new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: {
                id: pId,
                title: vars.product?.title ?? existing?.title ?? "Test Title",
                status: vars.product?.status ?? existing?.status ?? "DRAFT",
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 8. Product delete (compensation)
    if (query.includes("ProductDelete")) {
      if (options.productDeleteUserErrors && options.productDeleteUserErrors.length > 0) {
        return new Response(
          JSON.stringify({
            data: {
              productDelete: {
                deletedProductId: null,
                userErrors: options.productDeleteUserErrors,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const vars = (init?.variables ?? {}) as { input?: { id?: string } };
      const deletedProductId =
        options.productDeleteDeletedId !== undefined
          ? options.productDeleteDeletedId
          : vars.input?.id ?? "gid://shopify/Product/1";

      return new Response(
        JSON.stringify({
          data: {
            productDelete: {
              deletedProductId,
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unhandled GraphQL query: ${query}`);
  });

  const admin = { graphql } as unknown as ProductSyncAdminClient;

  return {
    admin,
    graphql,
    calls,
    products,
    getProduct(id: string) {
      return products.get(id);
    },
    countCalls(keyword: string) {
      return calls.filter((c) => c.query.includes(keyword)).length;
    },
    findCall(keyword: string) {
      return calls.find((c) => c.query.includes(keyword));
    },
  };
}

describe("Shopify Product Sync (DB-backed)", { timeout: 60_000 }, () => {
  let db: TestDb;
  let service: CatalogService;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    db = await createTestDb();
    service = createCatalogService({ prisma: db.prisma });

    const sA = await seedShop(db.prisma, "sync-shop-a.myshopify.com");
    const sB = await seedShop(db.prisma, "sync-shop-b.myshopify.com");
    shopA = sA.shopId;
    shopB = sB.shopId;
  });

  afterAll(async () => {
    await db.drop();
  });

  // =========================================================================
  // Spec 17 Examples Table Rows
  // =========================================================================

  describe("Spec 17 Examples Table", () => {
    it("Example 1: new lens, price 8000 USD -> productCreate + variant price '80.00', markSynced called", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      const lens = await service.createLens(shopA, {
        groupId,
        name: "Standard SV 1.50",
        priceMinor: 8000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -600,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "SV-150",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      const result = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);
      expect(result.productId).toBeDefined();
      expect(result.variantId).toBeDefined();

      // productCreate called with title, vendor, tags, seo.hidden metafield
      expect(fake.countCalls("ProductCreate")).toBe(1);
      const createCall = fake.findCall("ProductCreate");
      const vars = (createCall?.variables ?? {}) as ProductCreateVariables;
      const productInput = vars.product;
      expect(productInput?.title).toBe("Lens: Standard SV 1.50");
      expect(productInput?.vendor).toBe("Lens Advisor");
      expect(productInput?.tags).toEqual(["lens-advisor-item"]);
      expect(productInput?.status).toBe("ACTIVE");
      expect(productInput?.metafields).toEqual([
        {
          namespace: "seo",
          key: "hidden",
          value: "1",
          type: "number_integer",
        },
      ]);

      // variant update called with variant price "80.00" and inventory not tracked
      expect(fake.countCalls("ProductVariantsBulkUpdate")).toBe(1);
      const updateCall = fake.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      const variantsInput = updateVars.variants;
      expect(variantsInput).toEqual([
        {
          id: result.variantId,
          price: "80.00",
          inventoryItem: {
            tracked: false,
          },
        },
      ]);

      // published to Online Store channel
      expect(fake.countCalls("PublishablePublish")).toBe(1);

      // markSynced called -> verify DB row has shopifyVariantId and shopifyProductId
      const updatedLens = await service.getLens(shopA, lens.id);
      expect(updatedLens.shopifyVariantId).toBe(result.variantId);
      expect(updatedLens.shopifyProductId).toBe(result.productId);
    });

    it("Example 2: same lens saved again with 9000 -> variant update only, no create (idempotent)", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      // 1. Initial creation and sync
      const lens = await service.createLens(shopA, {
        groupId,
        name: "Premium Progressive 1.67",
        priceMinor: 8000,
        currency: "USD",
        rxTypes: ["PROGRESSIVE"],
        sphMin: -800,
        sphMax: 600,
        cylMin: -400,
        cylMax: 0,
        labCodeTemplate: "PROG-167",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      const firstSync = await syncItem(fake1.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(firstSync.created).toBe(true);

      // 2. Lens price updated to 9000 in DB
      await service.updateLens(shopA, lens.id, {
        priceMinor: 9000,
      });

      // 3. Sync again
      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const secondSync = await syncItem(fake2.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(secondSync.ok).toBe(true);
      expect(secondSync.updated).toBe(true);
      expect(secondSync.created).toBeFalsy();

      // No productCreate on second sync!
      expect(fake2.countCalls("ProductCreate")).toBe(0);

      // Variant update only, with new price "90.00"
      expect(fake2.countCalls("ProductVariantsBulkUpdate")).toBe(1);
      const updateCall = fake2.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      const variantsInput = updateVars.variants;
      expect(variantsInput).toEqual([
        {
          id: firstSync.variantId,
          price: "90.00",
          inventoryItem: {
            tracked: false,
          },
        },
      ]);
    });

    it("Example 3: option value delta 0 -> no product; no variant id (zero price)", async () => {
      const optGroup = await service.createOptionGroup(shopA, {
        name: "Lens Material",
        kind: "MATERIAL",
      });

      const optVal = await service.createOptionValue(shopA, {
        optionGroupId: optGroup.id,
        label: "CR-39 Standard Plastic",
        priceDeltaMinor: 0,
        currency: "USD",
        tokenKey: "material",
        tokenValue: "CR39",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });
      const result = await syncItem(fake.admin, shopA, "optionValue", optVal.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(fake.calls.length).toBe(0);

      // In DB: no variant id assigned
      const checkVal = await service.getOptionValue(shopA, optVal.id);
      expect(checkVal.shopifyVariantId).toBeNull();
    });

    it("Example 4: option delta 0 -> 1500 -> product created (becomes priced)", async () => {
      const optGroup = await service.createOptionGroup(shopA, {
        name: "Coating",
        kind: "MATERIAL",
      });

      const optVal = await service.createOptionValue(shopA, {
        optionGroupId: optGroup.id,
        label: "Anti-Reflective Coating",
        priceDeltaMinor: 0,
        currency: "USD",
        tokenKey: "coating",
        tokenValue: "AR",
      });

      // Becomes priced to 1500 USD
      await service.updateOptionValue(shopA, optVal.id, {
        priceDeltaMinor: 1500,
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });
      const result = await syncItem(fake.admin, shopA, "optionValue", optVal.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);
      expect(result.variantId).toBeDefined();

      // Product created with "Option: Anti-Reflective Coating"
      expect(fake.countCalls("ProductCreate")).toBe(1);
      const createCall = fake.findCall("ProductCreate");
      const vars = (createCall?.variables ?? {}) as ProductCreateVariables;
      expect(vars.product?.title).toBe("Option: Anti-Reflective Coating");

      // Variant price set to "15.00"
      expect(fake.countCalls("ProductVariantsBulkUpdate")).toBe(1);
      const updateCall = fake.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      expect(updateVars.variants?.[0]?.price).toBe("15.00");

      // In DB: variant id saved
      const updatedVal = await service.getOptionValue(shopA, optVal.id);
      expect(updatedVal.shopifyVariantId).toBe(result.variantId);
    });

    it("Example 5: archived lens -> product set to DRAFT", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      // Create and sync lens
      const lens = await service.createLens(shopA, {
        groupId,
        name: "Lens To Archive",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 200,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "ARCH-1",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      const syncRes = await syncItem(fake1.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      // Archive in DB
      await service.archiveLens(shopA, lens.id);

      // Now call archiveItem
      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const archiveRes = await archiveItem(fake2.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(archiveRes.ok).toBe(true);
      expect(archiveRes.archived).toBe(true);
      expect(archiveRes.status).toBe("DRAFT");
      expect(archiveRes.productId).toBe(syncRes.productId);

      // ProductUpdate called with status DRAFT
      expect(fake2.countCalls("ProductUpdate")).toBe(1);
      const updateCall = fake2.findCall("ProductUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductUpdateVariables;
      expect(updateVars.product).toEqual({
        id: syncRes.productId,
        status: "DRAFT",
      });
    });

    it("Example 6: GraphQL userErrors -> SyncError with the Shopify message; catalog row unchanged", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      const lens = await service.createLens(shopA, {
        groupId,
        name: "Lens With Failing Sync",
        priceMinor: 6000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 200,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "FAIL-1",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        createProductUserErrors: [
          {
            field: ["title"],
            message: "Title exceeds maximum length of 255 characters",
          },
        ],
      });

      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(
        new SyncError("Title exceeds maximum length of 255 characters"),
      );

      // DB row unchanged! shopifyVariantId and shopifyProductId must still be null
      const row = await service.getLens(shopA, lens.id);
      expect(row.shopifyVariantId).toBeNull();
      expect(row.shopifyProductId).toBeNull();
    });
  });

  // =========================================================================
  // Invariant INV-1: Multi-shop tenant isolation
  // =========================================================================

  describe("INV-1: Shop isolation", () => {
    it("sync for shop B with shop A's lens throws NotFoundError and leaves row untouched", async () => {
      const groups = await service.listLensGroups(shopA);
      const lensA = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Shop A Private Lens",
        priceMinor: 7500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -300,
        sphMax: 300,
        cylMin: -100,
        cylMax: 0,
        labCodeTemplate: "SHOP-A",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      // Shop B attempts to sync Shop A's lens
      await expect(
        syncItem(fake.admin, shopB, "lens", lensA.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(NotFoundError);

      // Fake client recorded zero Shopify mutations
      expect(fake.countCalls("ProductCreate")).toBe(0);

      // Shop A row remains untouched
      const checkLens = await service.getLens(shopA, lensA.id);
      expect(checkLens.shopifyVariantId).toBeNull();
      expect(checkLens.shopifyProductId).toBeNull();
    });

    it("sync for shop B with shop A's option value throws NotFoundError and leaves row untouched", async () => {
      const groupA = await service.createOptionGroup(shopA, {
        name: "Shop A Tint Group",
        kind: "TINT_TYPE",
      });
      const valA = await service.createOptionValue(shopA, {
        optionGroupId: groupA.id,
        label: "Shop A Polarized Grey",
        priceDeltaMinor: 2000,
        currency: "USD",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      await expect(
        syncItem(fake.admin, shopB, "optionValue", valA.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(NotFoundError);

      expect(fake.calls.length).toBe(0);

      const checkVal = await service.getOptionValue(shopA, valA.id);
      expect(checkVal.shopifyVariantId).toBeNull();
    });

    it("sync for shop B with shop A's add-on throws NotFoundError and leaves row untouched", async () => {
      const addOnA = await service.createAddOn(shopA, {
        name: "Shop A Cleaning Cloth",
        priceMinor: 500,
        currency: "USD",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      await expect(
        syncItem(fake.admin, shopB, "addOn", addOnA.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(NotFoundError);

      expect(fake.calls.length).toBe(0);

      const checkAddOn = await service.getAddOn(shopA, addOnA.id);
      expect(checkAddOn.shopifyVariantId).toBeNull();
      expect(checkAddOn.shopifyProductId).toBeNull();
    });

    it("archiveItem for shop B with shop A's lens throws NotFoundError and leaves row untouched", async () => {
      const groups = await service.listLensGroups(shopA);
      const lensA = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Shop A Archiving Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "ARCH-A",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      await expect(
        archiveItem(fake.admin, shopB, "lens", lensA.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(NotFoundError);

      expect(fake.countCalls("ProductUpdate")).toBe(0);
    });
  });

  // =========================================================================
  // Invariant INV-4 & Currency Handling (JPY, KWD, USD, EUR)
  // =========================================================================

  describe("INV-4: Currencies and integer decimal conversion", () => {
    it("handles 0-decimal currency JPY: 1500 JPY -> '1500'", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Tokyo SV 1.56",
        priceMinor: 1500,
        currency: "JPY",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -600,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "TYO-156",
      });

      const fake = createFakeAdminClient({ shopCurrency: "JPY" });
      const result = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      const updateCall = fake.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      const variantPrice = updateVars.variants?.[0]?.price;
      expect(variantPrice).toBe("1500");
    });

    it("handles 3-decimal currency KWD: 1500 KWD -> '1.500'", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Kuwait Hi-Index 1.74",
        priceMinor: 1500,
        currency: "KWD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -800,
        sphMax: 600,
        cylMin: -400,
        cylMax: 0,
        labCodeTemplate: "KWD-174",
      });

      const fake = createFakeAdminClient({ shopCurrency: "KWD" });
      const result = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      const updateCall = fake.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      const variantPrice = updateVars.variants?.[0]?.price;
      expect(variantPrice).toBe("1.500");
    });

    it("throws CURRENCY_MISMATCH when item currency does not match shop currency", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Euro Lens in USD Store",
        priceMinor: 5000,
        currency: "EUR",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "EUR-1",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      const err = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(SyncError);
      expect((err as SyncError).code).toBe("CURRENCY_MISMATCH");

      // No product created and row unchanged
      expect(fake.countCalls("ProductCreate")).toBe(0);
      const checkLens = await service.getLens(shopA, lens.id);
      expect(checkLens.shopifyVariantId).toBeNull();
    });
  });

  // =========================================================================
  // Add-Ons & Option Values & Edge Cases
  // =========================================================================

  describe("Add-ons and Option Values Syncing", () => {
    it("syncs an add-on item: creates product, variant, publishes, markSynced", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Microfiber Cleaning Kit",
        priceMinor: 2500,
        currency: "USD",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });
      const result = await syncItem(fake.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);
      expect(result.productId).toBeDefined();
      expect(result.variantId).toBeDefined();

      const createCall = fake.findCall("ProductCreate");
      const createVars = (createCall?.variables ?? {}) as ProductCreateVariables;
      expect(createVars.product?.title).toBe("Add-on: Microfiber Cleaning Kit");

      const updateCall = fake.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      expect(updateVars.variants?.[0]?.price).toBe("25.00");

      const checkAddOn = await service.getAddOn(shopA, addOn.id);
      expect(checkAddOn.shopifyVariantId).toBe(result.variantId);
      expect(checkAddOn.shopifyProductId).toBe(result.productId);
    });

    it("saving an add-on again updates variant only, no product create", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Luxury Case",
        priceMinor: 3000,
        currency: "USD",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      await syncItem(fake1.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      // Update price in DB
      await service.updateAddOn(shopA, addOn.id, {
        priceMinor: 3500,
      });

      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const res2 = await syncItem(fake2.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      expect(res2.ok).toBe(true);
      expect(res2.updated).toBe(true);
      expect(fake2.countCalls("ProductCreate")).toBe(0);
      expect(fake2.countCalls("ProductVariantsBulkUpdate")).toBe(1);

      const updateCall = fake2.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      expect(updateVars.variants?.[0]?.price).toBe("35.00");
    });

    it("updating option value price delta updates variant price via derived productId", async () => {
      const group = await service.createOptionGroup(shopA, {
        name: "Photochromic",
        kind: "COLOR",
      });

      const optVal = await service.createOptionValue(shopA, {
        optionGroupId: group.id,
        label: "Transitions Brown",
        priceDeltaMinor: 4000,
        currency: "USD",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      await syncItem(fake1.admin, shopA, "optionValue", optVal.id, {
        catalogService: service,
      });

      // Update delta to 4500
      await service.updateOptionValue(shopA, optVal.id, {
        priceDeltaMinor: 4500,
      });

      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const res2 = await syncItem(fake2.admin, shopA, "optionValue", optVal.id, {
        catalogService: service,
      });

      expect(res2.ok).toBe(true);
      expect(res2.updated).toBe(true);
      expect(fake2.countCalls("ProductCreate")).toBe(0);
      // Fetched variant product to get productId
      expect(fake2.countCalls("GetVariantProduct")).toBe(1);
      expect(fake2.countCalls("ProductVariantsBulkUpdate")).toBe(1);
      const updateCall = fake2.findCall("ProductVariantsBulkUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductVariantsBulkUpdateVariables;
      expect(updateVars.variants?.[0]?.price).toBe("45.00");
    });

    it("archiveItem sets add-on product to DRAFT", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Add-on To Archive",
        priceMinor: 1000,
        currency: "USD",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      await syncItem(fake1.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const archiveRes = await archiveItem(fake2.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      expect(archiveRes.ok).toBe(true);
      expect(archiveRes.archived).toBe(true);
      expect(archiveRes.status).toBe("DRAFT");
      expect(fake2.countCalls("ProductUpdate")).toBe(1);
    });

    it("archiveItem on unsynced item returns NOT_SYNCED and makes no Shopify calls", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Never Synced Add-on",
        priceMinor: 1000,
        currency: "USD",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });
      const archiveRes = await archiveItem(fake.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      expect(archiveRes.ok).toBe(true);
      expect(archiveRes.archived).toBe(false);
      expect(archiveRes.reason).toBe("NOT_SYNCED");
      expect(fake.calls.length).toBe(0);
    });

    it("rejects unknown entity type with BadRequestError", async () => {
      const fake = createFakeAdminClient();
      await expect(
        syncItem(fake.admin, shopA, "unknownEntity" as SyncEntity, "some-id", {
          catalogService: service,
        }),
      ).rejects.toThrow(BadRequestError);

      await expect(
        archiveItem(fake.admin, shopA, "unknownEntity" as SyncEntity, "some-id", {
          catalogService: service,
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it("handles GraphQL top-level errors by throwing SyncError", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Top Level Error Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "ERR-1",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        topLevelErrors: [{ message: "Throttled: API rate limit exceeded" }],
      });

      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(new SyncError("Throttled: API rate limit exceeded"));
    });

    it("R1-F2: variant update fails once, retry -> exactly one productCreate call overall and the stored id is reused", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Retry Partial Failure Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R1F2-1",
      });

      let variantUpdateAttempts = 0;
      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        customHandler: (query) => {
          if (query.includes("ProductVariantsBulkUpdate")) {
            variantUpdateAttempts++;
            if (variantUpdateAttempts === 1) {
              return new Response(
                JSON.stringify({
                  data: {
                    productVariantsBulkUpdate: {
                      productVariants: [],
                      userErrors: [{ field: ["price"], message: "Temporary variant update failure" }],
                    },
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }
          }
          return undefined;
        },
      });

      // Call 1: fails at variant update
      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(new SyncError("Temporary variant update failure"));

      // Exactly 1 productCreate call so far
      expect(fake.countCalls("ProductCreate")).toBe(1);

      // Verify IDs are persisted in catalog DB immediately after productCreate succeeded
      const intermediate = await service.getLens(shopA, lens.id);
      expect(intermediate.shopifyProductId).toBeTruthy();
      expect(intermediate.shopifyVariantId).toBeTruthy();

      // Call 2: retry on the same item succeeds
      const retryRes = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(retryRes.ok).toBe(true);
      expect(retryRes.updated).toBe(true);
      // ProductCreate call count remains EXACTLY 1 overall!
      expect(fake.countCalls("ProductCreate")).toBe(1);
      // Stored IDs are reused
      expect(retryRes.productId).toBe(intermediate.shopifyProductId);
      expect(retryRes.variantId).toBe(intermediate.shopifyVariantId);

      const finalLens = await service.getLens(shopA, lens.id);
      expect(finalLens.shopifyProductId).toBe(intermediate.shopifyProductId);
      expect(finalLens.shopifyVariantId).toBe(intermediate.shopifyVariantId);
    });

    it("R1-F2 compensation: if persisting fails right after create, deletes created product before throwing SyncError", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Persist Failure Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R1F2-2",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      const spy = vi
        .spyOn(service, "markSynced")
        .mockRejectedValueOnce(new Error("DB connection lost during markSynced"));

      try {
        await expect(
          syncItem(fake.admin, shopA, "lens", lens.id, {
            catalogService: service,
          }),
        ).rejects.toThrow(
          new SyncError("Failed to persist synced product: DB connection lost during markSynced"),
        );
      } finally {
        spy.mockRestore();
      }

      // Product was created...
      expect(fake.countCalls("ProductCreate")).toBe(1);
      // ...and compensated via ProductDelete!
      expect(fake.countCalls("ProductDelete")).toBe(1);
      const deleteCall = fake.findCall("ProductDelete");
      expect(deleteCall?.variables).toEqual({
        input: { id: "gid://shopify/Product/1" },
      });

      // DB row untouched
      const untouched = await service.getLens(shopA, lens.id);
      expect(untouched.shopifyProductId).toBeNull();
      expect(untouched.shopifyVariantId).toBeNull();
    });

    it("handles userErrors in publish: throws SyncError and persists IDs so retry reuses them", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Publish Error Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "ERR-3",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        publishUserErrors: [{ message: "Publication access denied" }],
      });

      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(new SyncError("Publication access denied"));

      const check = await service.getLens(shopA, lens.id);
      expect(check.shopifyVariantId).toBeTruthy();
      expect(check.shopifyProductId).toBeTruthy();
    });

    it("R1-F3: paginates publications until Online Store is found on a later page", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Later Page Publication Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R1F3-1",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        publicationsPages: [
          {
            nodes: [
              { id: "gid://shopify/Publication/1", name: "Point of Sale" },
              { id: "gid://shopify/Publication/2", name: "Shopify Inbox" },
            ],
            pageInfo: { hasNextPage: true, endCursor: "page-1-cursor" },
          },
          {
            nodes: [
              { id: "gid://shopify/Publication/888", name: "Online Store" },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        ],
      });

      const result = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);

      // Paginates: called GetPublications twice
      expect(fake.countCalls("GetPublications")).toBe(2);
      const firstPubCall = fake.calls.filter((c) => c.query.includes("GetPublications"))[0];
      const secondPubCall = fake.calls.filter((c) => c.query.includes("GetPublications"))[1];
      expect(firstPubCall.variables).toBeUndefined();
      expect(secondPubCall.variables).toEqual({ after: "page-1-cursor" });

      // Published to publication 888 found on page 2
      expect(fake.countCalls("PublishablePublish")).toBe(1);
      const pubCall = fake.findCall("PublishablePublish");
      expect(pubCall?.variables).toEqual({
        id: result.productId,
        input: [{ publicationId: "gid://shopify/Publication/888" }],
      });

      // Item marked synced
      const synced = await service.getLens(shopA, lens.id);
      expect(synced.shopifyProductId).toBe(result.productId);
      expect(synced.shopifyVariantId).toBe(result.variantId);
    });

    it("R1-F3: throws SyncError and does not markSynced when Online Store publication is absent", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Missing Online Store Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R1F3-2",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        publicationsPages: [
          {
            nodes: [
              { id: "gid://shopify/Publication/1", name: "Point of Sale" },
              { id: "gid://shopify/Publication/2", name: "Shopify Inbox" },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        ],
      });

      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(new SyncError("Online Store publication not found", "SYNC_FAILED"));

      // Product was NOT created
      expect(fake.countCalls("ProductCreate")).toBe(0);

      // markSynced was NOT called: catalog DB row remains un-synced
      const check = await service.getLens(shopA, lens.id);
      expect(check.shopifyProductId).toBeNull();
      expect(check.shopifyVariantId).toBeNull();
    });

    it("Self-check 2: Never creates a duplicate product on retry (look up by stored id first)", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Retry Proof Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "RETRY-1",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      // Run 1: initial sync creates the product
      const run1 = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(run1.created).toBe(true);
      expect(fake.countCalls("ProductCreate")).toBe(1);

      // Run 2: retry on the exact same item
      const run2 = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(run2.updated).toBe(true);
      // ProductCreate call count is STILL 1!
      expect(fake.countCalls("ProductCreate")).toBe(1);

      // Run 3: third retry
      const run3 = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(run3.updated).toBe(true);
      // ProductCreate call count is STILL 1!
      expect(fake.countCalls("ProductCreate")).toBe(1);

      // Product and variant IDs are preserved
      expect(run2.productId).toBe(run1.productId);
      expect(run2.variantId).toBe(run1.variantId);
      expect(run3.productId).toBe(run1.productId);
      expect(run3.variantId).toBe(run1.variantId);
    });

    it("R2-F1: publish fails once after ids are persisted, retry publishes and reports success", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Publish Fail Once Lens",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R2F1-1",
      });

      let publishAttempts = 0;
      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        customHandler: (query) => {
          if (query.includes("PublishablePublish")) {
            publishAttempts++;
            if (publishAttempts === 1) {
              return new Response(
                JSON.stringify({
                  data: {
                    publishablePublish: {
                      publishable: null,
                      userErrors: [{ field: ["publicationId"], message: "Storefront temporarily unavailable" }],
                    },
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }
          }
          return undefined;
        },
      });

      // Call 1: fails at publishablePublish after productCreate and markSynced succeeded
      await expect(
        syncItem(fake.admin, shopA, "lens", lens.id, {
          catalogService: service,
        }),
      ).rejects.toThrow(new SyncError("Storefront temporarily unavailable"));

      // Exactly 1 productCreate call so far
      expect(fake.countCalls("ProductCreate")).toBe(1);
      // Publish was attempted once
      expect(fake.countCalls("PublishablePublish")).toBe(1);

      // Verify IDs were already persisted right after productCreate
      const intermediate = await service.getLens(shopA, lens.id);
      expect(intermediate.shopifyProductId).toBeTruthy();
      expect(intermediate.shopifyVariantId).toBeTruthy();

      // Call 2: retry on the same item succeeds
      const retryRes = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(retryRes.ok).toBe(true);
      expect(retryRes.updated).toBe(true);
      // ProductCreate was NOT called again (still 1 overall)
      expect(fake.countCalls("ProductCreate")).toBe(1);
      // ProductUpdate was called to ensure title, ACTIVE status, metafields
      expect(fake.countCalls("ProductUpdate")).toBe(1);
      const updateCall = fake.findCall("ProductUpdate");
      expect(updateCall?.variables).toEqual({
        product: {
          id: intermediate.shopifyProductId,
          title: "Lens: Publish Fail Once Lens",
          vendor: "Lens Advisor",
          tags: ["lens-advisor-item"],
          status: "ACTIVE",
          metafields: [
            {
              namespace: "seo",
              key: "hidden",
              value: "1",
              type: "number_integer",
            },
          ],
        },
      });
      // PublishablePublish was called again (now 2 calls overall) and succeeded
      expect(fake.countCalls("PublishablePublish")).toBe(2);
      expect(retryRes.productId).toBe(intermediate.shopifyProductId);
      expect(retryRes.variantId).toBe(intermediate.shopifyVariantId);
    });

    it("R2-F1: renamed lens updates the product title, ensures ACTIVE status, and publishes", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Original Name Lens",
        priceMinor: 6000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R2F1-2",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      const initialSync = await syncItem(fake1.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(initialSync.ok).toBe(true);
      expect(initialSync.created).toBe(true);

      // Rename lens in catalog DB
      await service.updateLens(shopA, lens.id, {
        name: "Renamed Ultra Clear Lens",
      });

      // Sync again
      const fake2 = createFakeAdminClient({ shopCurrency: "USD" });
      const secondSync = await syncItem(fake2.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(secondSync.ok).toBe(true);
      expect(secondSync.updated).toBe(true);
      expect(fake2.countCalls("ProductCreate")).toBe(0);

      // ProductUpdate called with new title and ACTIVE status
      expect(fake2.countCalls("ProductUpdate")).toBe(1);
      const updateCall = fake2.findCall("ProductUpdate");
      expect(updateCall?.variables).toEqual({
        product: {
          id: initialSync.productId,
          title: "Lens: Renamed Ultra Clear Lens",
          vendor: "Lens Advisor",
          tags: ["lens-advisor-item"],
          status: "ACTIVE",
          metafields: [
            {
              namespace: "seo",
              key: "hidden",
              value: "1",
              type: "number_integer",
            },
          ],
        },
      });

      // Variant price updated and published
      expect(fake2.countCalls("ProductVariantsBulkUpdate")).toBe(1);
      expect(fake2.countCalls("PublishablePublish")).toBe(1);
    });

    it("R2-F2: compensation deletion user errors throws SyncError with code ORPHAN_PRODUCT and logs", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Delete User Error Lens",
        priceMinor: 4500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R2F2-1",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        productDeleteUserErrors: [{ field: ["id"], message: "Product is locked and cannot be deleted" }],
      });

      const markSyncedSpy = vi
        .spyOn(service, "markSynced")
        .mockRejectedValueOnce(new Error("DB failure during markSynced"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        let thrownError: unknown;
        try {
          await syncItem(fake.admin, shopA, "lens", lens.id, {
            catalogService: service,
          });
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(SyncError);
        const syncErr = thrownError as SyncError;
        expect(syncErr.code).toBe("ORPHAN_PRODUCT");
        expect(syncErr.status).toBe(400);

        // ProductCreate was called
        expect(fake.countCalls("ProductCreate")).toBe(1);
        // ProductDelete was attempted
        expect(fake.countCalls("ProductDelete")).toBe(1);

        // Logged only product GID and catalog id
        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedMsg = consoleErrorSpy.mock.calls[0].join(" ");
        expect(loggedMsg).toContain("gid://shopify/Product/1");
        expect(loggedMsg).toContain(lens.id);

        // Catalog row was NOT marked synced
        const check = await service.getLens(shopA, lens.id);
        expect(check.shopifyProductId).toBeNull();
        expect(check.shopifyVariantId).toBeNull();
      } finally {
        markSyncedSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it("R2-F2: compensation with missing/null deletedProductId throws SyncError with code ORPHAN_PRODUCT", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Missing Deleted Id Lens",
        priceMinor: 4500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R2F2-2",
      });

      const fake = createFakeAdminClient({
        shopCurrency: "USD",
        productDeleteDeletedId: null,
      });

      const markSyncedSpy = vi
        .spyOn(service, "markSynced")
        .mockRejectedValueOnce(new Error("DB failure during markSynced"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        let thrownError: unknown;
        try {
          await syncItem(fake.admin, shopA, "lens", lens.id, {
            catalogService: service,
          });
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(SyncError);
        const syncErr = thrownError as SyncError;
        expect(syncErr.code).toBe("ORPHAN_PRODUCT");
        expect(syncErr.status).toBe(400);

        expect(fake.countCalls("ProductCreate")).toBe(1);
        expect(fake.countCalls("ProductDelete")).toBe(1);

        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedMsg = consoleErrorSpy.mock.calls[0].join(" ");
        expect(loggedMsg).toContain("gid://shopify/Product/1");
        expect(loggedMsg).toContain(lens.id);
      } finally {
        markSyncedSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // Review R3 regressions: R3-F1 and R3-F2
  // =========================================================================

  describe("Review R3 regressions: R3-F1 and R3-F2", () => {
    it("R3-F1: uses number_integer metafield type in both productCreate and productUpdate mutations", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Metafield Type Lens",
        priceMinor: 5000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R3F1-1",
      });

      const fake = createFakeAdminClient({ shopCurrency: "USD" });

      // 1. Initial sync (productCreate)
      const initialSync = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(initialSync.ok).toBe(true);
      expect(initialSync.created).toBe(true);

      const createCall = fake.findCall("ProductCreate");
      const createVars = (createCall?.variables ?? {}) as ProductCreateVariables;
      expect(createVars.product?.metafields).toEqual([
        {
          namespace: "seo",
          key: "hidden",
          value: "1",
          type: "number_integer",
        },
      ]);

      // 2. Resync via stored ID (productUpdate)
      const resync = await syncItem(fake.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(resync.ok).toBe(true);
      expect(resync.updated).toBe(true);

      const updateCall = fake.findCall("ProductUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductUpdateVariables;
      expect(updateVars.product?.metafields).toEqual([
        {
          namespace: "seo",
          key: "hidden",
          value: "1",
          type: "number_integer",
        },
      ]);
    });

    it("R3-F2: resync restores drifted vendor and tags to Lens Advisor defaults", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Drifted Vendor Tags Lens",
        priceMinor: 6500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -100,
        sphMax: 100,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "R3F2-1",
      });

      // 1. Initial sync creates product on Shopify with standard vendor and tag
      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      const initialSync = await syncItem(fake1.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });
      expect(initialSync.ok).toBe(true);
      expect(initialSync.created).toBe(true);
      const productId = initialSync.productId!;

      const shopifyProduct = fake1.getProduct(productId);
      expect(shopifyProduct).toBeDefined();
      expect(shopifyProduct?.vendor).toBe("Lens Advisor");
      expect(shopifyProduct?.tags).toEqual(["lens-advisor-item"]);

      // 2. Merchant drifts the product on Shopify: modifies vendor and removes/changes tags
      shopifyProduct!.vendor = "Custom Vendor Inc.";
      shopifyProduct!.tags = ["merchant-manual-tag"];

      // 3. Resync using the stored ID converges and restores vendor and tags
      const fake2 = createFakeAdminClient({
        shopCurrency: "USD",
        products: fake1.products,
      });
      const resync = await syncItem(fake2.admin, shopA, "lens", lens.id, {
        catalogService: service,
      });

      expect(resync.ok).toBe(true);
      expect(resync.updated).toBe(true);
      expect(fake2.countCalls("ProductCreate")).toBe(0);
      expect(fake2.countCalls("ProductUpdate")).toBe(1);

      // Verify the ProductUpdate mutation payload sent to Shopify contains restored vendor and tags
      const updateCall = fake2.findCall("ProductUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductUpdateVariables;
      expect(updateVars.product).toEqual({
        id: productId,
        title: "Lens: Drifted Vendor Tags Lens",
        vendor: "Lens Advisor",
        tags: ["lens-advisor-item"],
        status: "ACTIVE",
        metafields: [
          {
            namespace: "seo",
            key: "hidden",
            value: "1",
            type: "number_integer",
          },
        ],
      });

      // Verify the remote Shopify product record has converged back to fresh-sync state
      const restoredProduct = fake2.getProduct(productId);
      expect(restoredProduct?.vendor).toBe("Lens Advisor");
      expect(restoredProduct?.tags).toEqual(["lens-advisor-item"]);
      expect(restoredProduct?.status).toBe("ACTIVE");
    });

    it("R3-F2: resync on add-on restores drifted vendor and tags", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Drifted AddOn",
        priceMinor: 2000,
        currency: "USD",
      });

      const fake1 = createFakeAdminClient({ shopCurrency: "USD" });
      const initialSync = await syncItem(fake1.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });
      expect(initialSync.ok).toBe(true);
      expect(initialSync.created).toBe(true);
      const productId = initialSync.productId!;

      // Merchant drifts vendor and removes tags
      const shopifyProduct = fake1.getProduct(productId);
      shopifyProduct!.vendor = "External Supplier";
      shopifyProduct!.tags = [];

      // Resync
      const fake2 = createFakeAdminClient({
        shopCurrency: "USD",
        products: fake1.products,
      });
      const resync = await syncItem(fake2.admin, shopA, "addOn", addOn.id, {
        catalogService: service,
      });

      expect(resync.ok).toBe(true);
      expect(resync.updated).toBe(true);

      const updateCall = fake2.findCall("ProductUpdate");
      const updateVars = (updateCall?.variables ?? {}) as ProductUpdateVariables;
      expect(updateVars.product?.vendor).toBe("Lens Advisor");
      expect(updateVars.product?.tags).toEqual(["lens-advisor-item"]);

      const restoredProduct = fake2.getProduct(productId);
      expect(restoredProduct?.vendor).toBe("Lens Advisor");
      expect(restoredProduct?.tags).toEqual(["lens-advisor-item"]);
    });
  });
});
