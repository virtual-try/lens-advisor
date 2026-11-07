import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogResponseSchema,
  type RxLimits,
} from "../../../packages/rx-core/src/index.js";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { NotFoundError } from "../../shared/http/errors.server";
import {
  createCatalogService,
  ValidationError,
  type CatalogService,
} from "./catalog.service.server";
import {
  addOnInputSchema,
  lensInputSchema,
  optionValueInputSchema,
} from "./schema";

describe("CatalogService (DB-backed)", { timeout: 60_000 }, () => {
  let db: TestDb;
  let service: CatalogService;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    db = await createTestDb();
    service = createCatalogService({ prisma: db.prisma });

    const sA = await seedShop(db.prisma, "service-shop-a.myshopify.com");
    const sB = await seedShop(db.prisma, "service-shop-b.myshopify.com");
    shopA = sA.shopId;
    shopB = sB.shopId;
  });

  afterAll(async () => {
    await db.drop();
  });

  // =========================================================================
  // Spec 14 Examples Table Rows
  // =========================================================================

  describe("Spec 14 Examples Table", () => {
    it("Example 1: create lens SPH -800..+600 -> saved; DTO limits -800/600", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      const created = await service.createLens(shopA, {
        groupId,
        name: "Standard Index 1.50",
        priceMinor: 4500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -800,
        sphMax: 600,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "SV-150",
      });

      expect(created.id).toBeDefined();
      expect(created.limits).toEqual<RxLimits>({
        sphMin: -800,
        sphMax: 600,
        cylMin: -200,
        cylMax: 0,
        rxTypes: ["SINGLE_VISION"],
      });
      expect(created.price).toEqual({
        amountMinor: 4500,
        currency: "USD",
      });
    });

    it("Example 2: create lens sphMin 600, sphMax -800 -> ValidationError LIMITS_INVERTED", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      await expect(
        service.createLens(shopA, {
          groupId,
          name: "Inverted Lens",
          priceMinor: 5000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: 600,
          sphMax: -800,
          cylMin: -200,
          cylMax: 0,
        }),
      ).rejects.toThrow(ValidationError);

      try {
        await service.createLens(shopA, {
          groupId,
          name: "Inverted Lens",
          priceMinor: 5000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: 600,
          sphMax: -800,
          cylMin: -200,
          cylMax: 0,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("LIMITS_INVERTED");
      }
    });

    it("Example 3: price -1 -> ValidationError NEGATIVE_PRICE", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      await expect(
        service.createLens(shopA, {
          groupId,
          name: "Negative Price Lens",
          priceMinor: -1,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -400,
          sphMax: 400,
          cylMin: -200,
          cylMax: 0,
        }),
      ).rejects.toThrow(ValidationError);

      try {
        await service.createLens(shopA, {
          groupId,
          name: "Negative Price Lens",
          priceMinor: -1,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -400,
          sphMax: 400,
          cylMin: -200,
          cylMax: 0,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("NEGATIVE_PRICE");
      }
    });

    it("Example 4: archive lens; getStorefrontCatalog -> lens absent; getLens still returns it", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      // Create a lens with a variant id so it would normally appear in storefront
      const lens = await service.createLens(shopA, {
        groupId,
        name: "Lens To Soft Delete",
        priceMinor: 6000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        shopifyVariantId: "gid://shopify/ProductVariant/998877",
      });

      // Confirm it would appear in storefront catalog before archive
      const catalogBefore = await service.getStorefrontCatalog(shopA);
      const foundInBefore = catalogBefore.lensGroups
        .flatMap((g) => g.lenses)
        .some((l) => l.id === lens.id);
      expect(foundInBefore).toBe(true);

      // Now archive the lens
      await service.archiveLens(shopA, lens.id);

      // Verify getStorefrontCatalog excludes it
      const catalogAfter = await service.getStorefrontCatalog(shopA);
      const foundInAfter = catalogAfter.lensGroups
        .flatMap((g) => g.lenses)
        .some((l) => l.id === lens.id);
      expect(foundInAfter).toBe(false);

      // But getLens still returns it!
      const fetched = await service.getLens(shopA, lens.id);
      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(lens.id);
      expect(fetched.archivedAt).not.toBeNull();
    });

    it("Example 5: lens without variant id -> absent from storefront catalog", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      // Lens created without shopifyVariantId (unsynced)
      const unsyncedLens = await service.createLens(shopA, {
        groupId,
        name: "Unsynced Lens Without Variant",
        priceMinor: 7500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -300,
        sphMax: 300,
        cylMin: -100,
        cylMax: 0,
      });

      expect(unsyncedLens.shopifyVariantId).toBeNull();

      const catalog = await service.getStorefrontCatalog(shopA);
      const existsInStorefront = catalog.lensGroups
        .flatMap((g) => g.lenses)
        .some((l) => l.id === unsyncedLens.id);

      expect(existsInStorefront).toBe(false);
    });

    it("Example 6: shop B calls updateLens with shop A's id -> NotFoundError, row unchanged", async () => {
      const lensesA = await service.listLenses(shopA);
      const lensA = lensesA[0];
      const originalName = lensA.name;

      await expect(
        service.updateLens(shopB, lensA.id, { name: "Attacker Lens Name" }),
      ).rejects.toThrow(NotFoundError);

      const checkA = await service.getLens(shopA, lensA.id);
      expect(checkA.name).toBe(originalName);
    });
  });

  // =========================================================================
  // Invariants INV-4 and INV-5
  // =========================================================================

  describe("Invariants: INV-4 (integer money) & INV-5 (integer diopters)", () => {
    it("INV-4: prices round-trip as integers; float input is rejected by schema.ts", () => {
      // Float price in lens schema rejected
      const floatLens = lensInputSchema.safeParse({
        groupId: "grp_1",
        name: "Float Lens",
        priceMinor: 12.5,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });
      expect(floatLens.success).toBe(false);

      // Float price in option value schema rejected
      const floatOption = optionValueInputSchema.safeParse({
        optionGroupId: "og_1",
        label: "Float Option",
        priceDeltaMinor: 15.75,
      });
      expect(floatOption.success).toBe(false);

      // Float price in add-on schema rejected
      const floatAddOn = addOnInputSchema.safeParse({
        name: "Float Addon",
        priceMinor: 9.99,
      });
      expect(floatAddOn.success).toBe(false);

      // Valid integer prices accepted
      const validLens = lensInputSchema.safeParse({
        groupId: "grp_1",
        name: "Valid Lens",
        priceMinor: 1250,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });
      expect(validLens.success).toBe(true);
    });

    it("INV-5: limits round-trip as integer hundredths; float input is rejected by schema.ts", async () => {
      // Float SPH rejected
      const floatSph = lensInputSchema.safeParse({
        groupId: "grp_1",
        name: "Float SPH",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -2.25,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });
      expect(floatSph.success).toBe(false);

      // Float CYL rejected
      const floatCyl = lensInputSchema.safeParse({
        groupId: "grp_1",
        name: "Float CYL",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -1.75,
        cylMax: 0,
      });
      expect(floatCyl.success).toBe(false);

      // Float ADD rejected
      const floatAdd = lensInputSchema.safeParse({
        groupId: "grp_1",
        name: "Float ADD",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["PROGRESSIVE"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        addMin: 1.5,
        addMax: 300,
      });
      expect(floatAdd.success).toBe(false);

      // Integer hundredths round-trip correctly through service
      const groups = await service.listLensGroups(shopA);
      const created = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Integer Hundredths Lens",
        priceMinor: 3000,
        currency: "USD",
        rxTypes: ["PROGRESSIVE"],
        sphMin: -225,
        sphMax: 175,
        cylMin: -150,
        cylMax: -25,
        addMin: 100,
        addMax: 250,
      });

      expect(created.limits.sphMin).toBe(-225);
      expect(created.limits.sphMax).toBe(175);
      expect(created.limits.cylMin).toBe(-150);
      expect(created.limits.cylMax).toBe(-25);
      expect(created.limits.addMin).toBe(100);
      expect(created.limits.addMax).toBe(250);
    });
  });

  // =========================================================================
  // Additional Business Logic Validations
  // =========================================================================

  describe("Business Logic Validations", () => {
    it("rejects inverted CYL limits (cylMin > cylMax)", async () => {
      const groups = await service.listLensGroups(shopA);
      await expect(
        service.createLens(shopA, {
          groupId: groups[0].id,
          name: "Inverted CYL",
          priceMinor: 2000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: 0,
          cylMax: -200,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects inverted ADD limits (addMin > addMax)", async () => {
      const groups = await service.listLensGroups(shopA);
      await expect(
        service.createLens(shopA, {
          groupId: groups[0].id,
          name: "Inverted ADD",
          priceMinor: 2000,
          currency: "USD",
          rxTypes: ["PROGRESSIVE"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -200,
          cylMax: 0,
          addMin: 300,
          addMax: 100,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("enforces unique lens names within a group", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;

      await service.createLens(shopA, {
        groupId,
        name: "Unique Lens Name Test",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });

      // Creating a lens with the same name in the same group fails
      await expect(
        service.createLens(shopA, {
          groupId,
          name: "  unique lens name test  ",
          priceMinor: 2000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("enforces unique group names within a shop", async () => {
      await service.createLensGroup(shopA, { name: "Unique Group Test" });

      await expect(
        service.createLensGroup(shopA, { name: "unique group test" }),
      ).rejects.toThrow(ValidationError);
    });

    it("enforces unique option group names within a shop", async () => {
      await service.createOptionGroup(shopA, {
        kind: "MATERIAL",
        name: "Unique Opt Group Test",
      });

      await expect(
        service.createOptionGroup(shopA, {
          kind: "COLOR",
          name: "unique opt group test",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("enforces unique option value labels within an option group", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;

      await service.createOptionValue(shopA, {
        optionGroupId: optGroupId,
        label: "Unique Value Test",
      });

      await expect(
        service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "unique value test",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("enforces unique add-on names within a shop", async () => {
      await service.createAddOn(shopA, {
        name: "Unique AddOn Test",
        priceMinor: 1000,
      });

      await expect(
        service.createAddOn(shopA, {
          name: "unique addon test",
          priceMinor: 1200,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects option value with both token and override code (ONE_CODE_SOURCE)", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;

      await expect(
        service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "Both Token And Override",
          tokenKey: "lens_material",
          tokenValue: "PO-67",
          overrideCode: "OVERRIDE-123",
        }),
      ).rejects.toThrow(ValidationError);

      try {
        await service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "Both Token And Override",
          tokenKey: "lens_material",
          tokenValue: "PO-67",
          overrideCode: "OVERRIDE-123",
        });
      } catch (err) {
        expect((err as ValidationError).code).toBe("ONE_CODE_SOURCE");
      }
    });

    it("rejects option value negative price delta (NEGATIVE_PRICE)", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;

      await expect(
        service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "Negative Option Delta",
          priceDeltaMinor: -500,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects add-on negative price (NEGATIVE_PRICE)", async () => {
      await expect(
        service.createAddOn(shopA, {
          name: "Negative Price Addon",
          priceMinor: -500,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // Storefront Catalog Output DTO
  // =========================================================================

  describe("Storefront Catalog DTO", () => {
    it("getStorefrontCatalog conforms strictly to catalogResponseSchema", async () => {
      // Seed a synced lens and add-on for shopA so storefront catalog has populated entries
      const groups = await service.listLensGroups(shopA);
      await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Synced Storefront Lens",
        priceMinor: 5500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -600,
        sphMax: 600,
        cylMin: -200,
        cylMax: 0,
        shopifyVariantId: "gid://shopify/ProductVariant/12345",
      });

      await service.createAddOn(shopA, {
        name: "Synced Storefront AddOn",
        priceMinor: 1500,
        currency: "USD",
        shopifyVariantId: "gid://shopify/ProductVariant/67890",
      });

      const catalog = await service.getStorefrontCatalog(shopA);

      // Validate against the pure rx-core zod schema
      const validated = catalogResponseSchema.parse(catalog);
      expect(validated).toBeDefined();
      expect(validated.lensGroups.length).toBeGreaterThan(0);
      expect(validated.optionGroups.length).toBeGreaterThan(0);
      expect(validated.addOns.length).toBeGreaterThan(0);
      expect(validated.settings).toHaveProperty("manualRxEnabled");
      expect(validated.settings).toHaveProperty("rxUploadEnabled");
      expect(validated.settings).toHaveProperty("storeRxInOrder");
    });
  });

  // =========================================================================
  // markSynced functionality
  // =========================================================================

  describe("markSynced", () => {
    it("marks lens synced and returns DTO with updated variant ID", async () => {
      const groups = await service.listLensGroups(shopA);
      const lens = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "Sync Target Lens",
        priceMinor: 4000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
      });

      expect(lens.shopifyVariantId).toBeNull();

      const synced = await service.markSynced(
        shopA,
        "lens",
        lens.id,
        "gid://shopify/ProductVariant/555",
        "gid://shopify/Product/555",
      );

      expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/555");
      if ("shopifyProductId" in synced) {
        expect(synced.shopifyProductId).toBe("gid://shopify/Product/555");
      }

      const refreshed = await service.getLens(shopA, lens.id);
      expect(refreshed.shopifyVariantId).toBe("gid://shopify/ProductVariant/555");
    });

    it("marks option value synced and returns DTO", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const val = await service.createOptionValue(shopA, {
        optionGroupId: optGroups[0].id,
        label: "Sync Target Value",
        priceDeltaMinor: 1500,
      });

      const synced = await service.markSynced(
        shopA,
        "optionValue",
        val.id,
        "gid://shopify/ProductVariant/777",
      );

      expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/777");
    });

    it("marks add-on synced and returns DTO", async () => {
      const addOn = await service.createAddOn(shopA, {
        name: "Sync Target AddOn",
        priceMinor: 2000,
      });

      const synced = await service.markSynced(
        shopA,
        "addOn",
        addOn.id,
        "gid://shopify/ProductVariant/888",
        "gid://shopify/Product/888",
      );

      expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/888");
      if ("shopifyProductId" in synced) {
        expect(synced.shopifyProductId).toBe("gid://shopify/Product/888");
      }
    });
  });
});
