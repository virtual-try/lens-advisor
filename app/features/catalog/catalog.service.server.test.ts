import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogResponseSchema,
  type RxLimits,
} from "../../../packages/rx-core/src/index.js";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { ConflictError, errorResponse, NotFoundError } from "../../shared/http/errors.server";
import {
  archiveAddOn,
  archiveLens,
  archiveLensGroup,
  archiveOptionGroup,
  archiveOptionValue,
  createCatalogService,
  ValidationError,
  type CatalogService,
} from "./catalog.service.server";
import {
  addOnInputSchema,
  lensInputSchema,
  optionValueInputSchema,
  validateInput,
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

    it("updateLens reassigning groupId to another shop's group throws NotFoundError and leaves row unchanged", async () => {
      const lensesA = await service.listLenses(shopA);
      const lensA = lensesA[0];
      const groupsB = await service.listLensGroups(shopB);
      const groupB = groupsB[0];
      const originalGroupId = lensA.groupId;

      await expect(
        service.updateLens(shopA, lensA.id, { groupId: groupB.id }),
      ).rejects.toThrow(NotFoundError);

      const checkA = await service.getLens(shopA, lensA.id);
      expect(checkA.groupId).toBe(originalGroupId);
    });

    it("createLens into an archived group throws NotFoundError (R5-F1)", async () => {
      const group = await service.createLensGroup(shopA, { name: "Archived Group For Create R5F1" });
      await service.deleteLensGroup(shopA, group.id);

      await expect(
        service.createLens(shopA, {
          groupId: group.id,
          name: "Lens in Archived Group",
          priceMinor: 1000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("updateLens moving a lens into an archived group throws NotFoundError and leaves row unchanged (R5-F1)", async () => {
      const activeGroup = await service.createLensGroup(shopA, { name: "Active Source Group R5F1" });
      const archivedGroup = await service.createLensGroup(shopA, { name: "Archived Target Group R5F1" });
      const lens = await service.createLens(shopA, {
        groupId: activeGroup.id,
        name: "Lens To Move R5F1",
        priceMinor: 1000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });

      await service.deleteLensGroup(shopA, archivedGroup.id);

      await expect(
        service.updateLens(shopA, lens.id, {
          groupId: archivedGroup.id,
        }),
      ).rejects.toThrow(NotFoundError);

      const checkLens = await service.getLens(shopA, lens.id);
      expect(checkLens.groupId).toBe(activeGroup.id);
    });

    it("updateOptionValue reassigning optionGroupId to another shop's group throws NotFoundError and leaves row unchanged", async () => {
      const optGroupsA = await service.listOptionGroups(shopA);
      const optGroupA = optGroupsA[0];
      const valueA = optGroupA.values[0];
      const optGroupsB = await service.listOptionGroups(shopB);
      const optGroupB = optGroupsB[0];
      const originalGroupId = valueA.optionGroupId;

      await expect(
        service.updateOptionValue(shopA, valueA.id, { optionGroupId: optGroupB.id }),
      ).rejects.toThrow(NotFoundError);

      const checkOptGroupA = await service.listOptionGroups(shopA);
      const checkValueA = checkOptGroupA[0].values.find((v) => v.id === valueA.id);
      expect(checkValueA?.optionGroupId).toBe(originalGroupId);
    });
  });

  // =========================================================================
  // Invariants INV-4 and INV-5
  // =========================================================================

  describe("Invariants: INV-4 (integer money) & INV-5 (integer diopters)", () => {
    it("INV-4 / R1-F1: nested DTO money is rejected with ValidationError and flat EUR price persists exactly", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;
      const lensGroups = await service.listLensGroups(shopA);
      const lensGroupId = lensGroups[0].id;

      // Nested DTO-shaped money is rejected by optionValue schema / validateInput
      expect(() => {
        validateInput(optionValueInputSchema, {
          optionGroupId: optGroupId,
          label: "Nested EUR Option",
          priceDelta: { amountMinor: 1500, currency: "EUR" },
        });
      }).toThrow(ValidationError);

      // Rejection also holds for service.createOptionValue
      await expect(
        service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "Nested EUR Option Service",
          priceDelta: { amountMinor: 1500, currency: "EUR" },
        } as never),
      ).rejects.toThrow(ValidationError);

      // Nested DTO money rejected by lens schema
      expect(() => {
        validateInput(lensInputSchema, {
          groupId: lensGroupId,
          name: "Nested EUR Lens",
          price: { amountMinor: 1500, currency: "EUR" },
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        });
      }).toThrow(ValidationError);

      // Nested DTO money rejected by addOn schema
      expect(() => {
        validateInput(addOnInputSchema, {
          name: "Nested EUR AddOn",
          price: { amountMinor: 1500, currency: "EUR" },
        });
      }).toThrow(ValidationError);

      // Flat EUR price is accepted and persists exactly (amount and currency)
      const createdOpt = await service.createOptionValue(shopA, {
        optionGroupId: optGroupId,
        label: "Flat EUR Option Exact",
        priceDeltaMinor: 1500,
        currency: "EUR",
      });
      expect(createdOpt.priceDelta).toEqual({
        amountMinor: 1500,
        currency: "EUR",
      });

      const fetchedOpt = await service.getOptionValue(shopA, createdOpt.id);
      expect(fetchedOpt.priceDelta).toEqual({
        amountMinor: 1500,
        currency: "EUR",
      });
    });

    it("INV-4 / R1-F3: float prices yield stable UPPER_SNAKE_CASE codes and conform to caller-visible ValidationError shape", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;

      // 1. Caller-visible ValidationError shape for float price in createLens
      try {
        await service.createLens(shopA, {
          groupId,
          name: "Float Price Lens",
          priceMinor: 12.5 as unknown as number,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        });
        expect.unreachable("createLens with float price should have thrown ValidationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.code).toBe("NOT_INTEGER");
        expect(valErr.message).toBe("Price must be an integer");
        expect(valErr.fields).toEqual([
          { path: "priceMinor", code: "NOT_INTEGER" },
        ]);

        const response = errorResponse(valErr);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toEqual({
          error: {
            code: "NOT_INTEGER",
            message: "Price must be an integer",
            fields: [
              { path: "priceMinor", code: "NOT_INTEGER" },
            ],
          },
        });
      }

      // 2. Float price in OptionValue
      try {
        await service.createOptionValue(shopA, {
          optionGroupId: optGroupId,
          label: "Float Delta Option",
          priceDeltaMinor: 15.75 as unknown as number,
        });
        expect.unreachable("createOptionValue with float delta should have thrown ValidationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.code).toBe("NOT_INTEGER");
        expect(valErr.fields?.[0]?.code).toBe("NOT_INTEGER");
      }

      // 3. Float price in AddOn
      try {
        await service.createAddOn(shopA, {
          name: "Float AddOn",
          priceMinor: 9.99 as unknown as number,
        });
        expect.unreachable("createAddOn with float price should have thrown ValidationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.code).toBe("NOT_INTEGER");
        expect(valErr.fields?.[0]?.code).toBe("NOT_INTEGER");
      }

      // 4. Invalid currency yields INVALID_CURRENCY code
      try {
        await service.createLens(shopA, {
          groupId,
          name: "Invalid Currency Lens",
          priceMinor: 2000,
          currency: "LOL" as unknown as "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        });
        expect.unreachable("createLens with invalid currency should have thrown ValidationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.code).toBe("INVALID_CURRENCY");
      }

      // 5. Missing required field yields REQUIRED code
      try {
        await service.createLens(shopA, {
          groupId,
          name: "",
          priceMinor: 2000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -200,
          sphMax: 200,
          cylMin: -100,
          cylMax: 0,
        });
        expect.unreachable("createLens with empty name should have thrown ValidationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.code).toBe("REQUIRED");
      }
    });

    it("INV-4 / R1-F6: DB-backed round-trip tests for every price field with non-default currency and odd amounts", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;
      const optGroups = await service.listOptionGroups(shopA);
      const optGroupId = optGroups[0].id;

      // 1. Lens with EUR and odd amount 4567
      const createdLens = await service.createLens(shopA, {
        groupId,
        name: "Odd EUR Round-Trip Lens",
        priceMinor: 4567,
        currency: "EUR",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });
      // Mark synced so it is published in storefront catalog
      await service.markSynced(shopA, "lens", createdLens.id, "gid://shopify/ProductVariant/EUR_LENS_4567");

      const fetchedLens = await service.getLens(shopA, createdLens.id);
      expect(fetchedLens.price).toEqual({
        amountMinor: 4567,
        currency: "EUR",
      });

      // 2. OptionValue with EUR and odd amount 1357
      const createdVal = await service.createOptionValue(shopA, {
        optionGroupId: optGroupId,
        label: "Odd EUR Round-Trip Option",
        priceDeltaMinor: 1357,
        currency: "EUR",
      });
      // Mark synced so it is published in storefront catalog
      await service.markSynced(shopA, "optionValue", createdVal.id, "gid://shopify/ProductVariant/EUR_OPT_1357");

      const fetchedVal = await service.getOptionValue(shopA, createdVal.id);
      expect(fetchedVal.priceDelta).toEqual({
        amountMinor: 1357,
        currency: "EUR",
      });

      // 3. AddOn with EUR and odd amount 987
      const createdAddOn = await service.createAddOn(shopA, {
        name: "Odd EUR Round-Trip AddOn",
        priceMinor: 987,
        currency: "EUR",
      });
      // Mark synced so it is published in storefront catalog
      await service.markSynced(shopA, "addOn", createdAddOn.id, "gid://shopify/ProductVariant/EUR_ADDON_987");

      const fetchedAddOn = await service.getAddOn(shopA, createdAddOn.id);
      expect(fetchedAddOn.price).toEqual({
        amountMinor: 987,
        currency: "EUR",
      });

      // 4. Assert round-trip through storefront catalog
      const storefrontCatalog = await service.getStorefrontCatalog(shopA);

      const storefrontLens = storefrontCatalog.lensGroups
        .flatMap((g) => g.lenses)
        .find((l) => l.id === createdLens.id);
      expect(storefrontLens).toBeDefined();
      expect(storefrontLens?.price).toEqual({
        amountMinor: 4567,
        currency: "EUR",
      });

      const storefrontVal = storefrontCatalog.optionGroups
        .flatMap((g) => g.values)
        .find((v) => v.id === createdVal.id);
      expect(storefrontVal).toBeDefined();
      expect(storefrontVal?.priceDelta).toEqual({
        amountMinor: 1357,
        currency: "EUR",
      });

      const storefrontAddOn = storefrontCatalog.addOns.find((a) => a.id === createdAddOn.id);
      expect(storefrontAddOn).toBeDefined();
      expect(storefrontAddOn?.price).toEqual({
        amountMinor: 987,
        currency: "EUR",
      });
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

    it("R1-F2: atomic uniqueness under advisory lock: two concurrent creates with the same name -> exactly one succeeds, other gets NAME_NOT_UNIQUE", async () => {
      const groups = await service.listLensGroups(shopA);
      const groupId = groups[0].id;
      const lensName = "Atomic Concurrent Lens";

      // Fire two concurrent creates with the exact same name
      const p1 = service.createLens(shopA, {
        groupId,
        name: lensName,
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });

      const p2 = service.createLens(shopA, {
        groupId,
        name: lensName,
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejReason).toBeInstanceOf(ValidationError);
      expect((rejReason as ValidationError).code).toBe("NAME_NOT_UNIQUE");

      // Similarly test concurrent group creates
      const groupName = "Atomic Concurrent Group";
      const g1 = service.createLensGroup(shopA, { name: groupName });
      const g2 = service.createLensGroup(shopA, { name: groupName });

      const gResults = await Promise.allSettled([g1, g2]);
      const gFulfilled = gResults.filter((r) => r.status === "fulfilled");
      const gRejected = gResults.filter((r) => r.status === "rejected");

      expect(gFulfilled).toHaveLength(1);
      expect(gRejected).toHaveLength(1);
      const gRejReason = (gRejected[0] as PromiseRejectedResult).reason;
      expect(gRejReason).toBeInstanceOf(ValidationError);
      expect((gRejReason as ValidationError).code).toBe("NAME_NOT_UNIQUE");
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

  // =========================================================================
  // Standalone archive wrappers (R1-F9)
  // =========================================================================

  describe("Standalone archive wrappers (R1-F9)", () => {
    it("archiveLensGroup standalone function archives group and returns DTO", async () => {
      const created = await service.createLensGroup(shopA, { name: "To Archive Standalone Group" });
      const archived = await archiveLensGroup(shopA, created.id, { prisma: db.prisma });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.id).toBe(created.id);
    });

    it("archiveLensGroup rejects archiving group with active lenses with ConflictError GROUP_NOT_EMPTY (R4-F1)", async () => {
      const createdGroup = await service.createLensGroup(shopA, { name: "Non-empty Group For Service" });
      await service.createLens(shopA, {
        groupId: createdGroup.id,
        name: "Active Lens in Group",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: 0,
        cylMax: 0,
        labCodeTemplate: "PO-TEST",
      });

      await expect(
        archiveLensGroup(shopA, createdGroup.id, { prisma: db.prisma }),
      ).rejects.toThrowError(ConflictError);
    });

    it("archiveLens standalone function archives lens and returns DTO", async () => {
      const groups = await service.listLensGroups(shopA);
      const created = await service.createLens(shopA, {
        groupId: groups[0].id,
        name: "To Archive Standalone Lens",
        priceMinor: 2000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });
      const archived = await archiveLens(shopA, created.id, { prisma: db.prisma });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.id).toBe(created.id);
    });

    it("archiveOptionGroup standalone function archives option group and returns DTO", async () => {
      const created = await service.createOptionGroup(shopA, {
        kind: "MATERIAL",
        name: "To Archive Standalone Opt Group",
      });
      const archived = await archiveOptionGroup(shopA, created.id, { prisma: db.prisma });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.id).toBe(created.id);
    });

    it("archiveOptionValue standalone function archives option value and returns DTO", async () => {
      const optGroups = await service.listOptionGroups(shopA);
      const created = await service.createOptionValue(shopA, {
        optionGroupId: optGroups[0].id,
        label: "To Archive Standalone Opt Value",
      });
      const archived = await archiveOptionValue(shopA, created.id, { prisma: db.prisma });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.id).toBe(created.id);
    });

    it("archiveAddOn standalone function archives add-on and returns DTO", async () => {
      const created = await service.createAddOn(shopA, {
        name: "To Archive Standalone AddOn",
        priceMinor: 1200,
      });
      const archived = await archiveAddOn(shopA, created.id, { prisma: db.prisma });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.id).toBe(created.id);
    });
  });
});
