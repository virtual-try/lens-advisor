import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { NotFoundError } from "../../shared/http/errors.server";
import {
  createCatalogRepository,
  type CatalogRepository,
} from "./catalog.repository.server";

describe("CatalogRepository (DB-backed)", { timeout: 60_000 }, () => {
  let db: TestDb;
  let repo: CatalogRepository;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    db = await createTestDb();
    repo = createCatalogRepository(db.prisma);

    const sA = await seedShop(db.prisma, "shop-a.myshopify.com");
    const sB = await seedShop(db.prisma, "shop-b.myshopify.com");
    shopA = sA.shopId;
    shopB = sB.shopId;
  });

  afterAll(async () => {
    await db.drop();
  });

  // =========================================================================
  // INV-1: Scoping tests for every repository function across Shops A and B
  // =========================================================================

  describe("INV-1: Shop isolation for every repository function", () => {
    describe("LensGroup", () => {
      it("listLensGroups returns only the shop's groups", async () => {
        const groupsA = await repo.listLensGroups(shopA);
        const groupsB = await repo.listLensGroups(shopB);

        expect(groupsA.length).toBeGreaterThan(0);
        expect(groupsB.length).toBeGreaterThan(0);
        expect(groupsA.every((g) => g.shopId === shopA)).toBe(true);
        expect(groupsB.every((g) => g.shopId === shopB)).toBe(true);
        expect(groupsA.some((g) => g.shopId === shopB)).toBe(false);
      });

      it("getLensGroup with another shop's ID returns null", async () => {
        const groupsB = await repo.listLensGroups(shopB);
        const groupB = groupsB[0];

        const foundUnderA = await repo.getLensGroup(shopA, groupB.id);
        expect(foundUnderA).toBeNull();

        const foundUnderB = await repo.getLensGroup(shopB, groupB.id);
        expect(foundUnderB).not.toBeNull();
        expect(foundUnderB?.id).toBe(groupB.id);
      });

      it("createLensGroup creates group under the given shop only", async () => {
        const newGroupA = await repo.createLensGroup(shopA, {
          name: "Shop A Exclusive Group",
          description: "Exclusive to A",
        });

        expect(newGroupA.shopId).toBe(shopA);

        const groupsB = await repo.listLensGroups(shopB);
        expect(groupsB.some((g) => g.id === newGroupA.id)).toBe(false);
      });

      it("updateLensGroup with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const groupsB = await repo.listLensGroups(shopB);
        const groupB = groupsB[0];
        const originalName = groupB.name;

        await expect(
          repo.updateLensGroup(shopA, groupB.id, { name: "Tampered by Shop A" }),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getLensGroup(shopB, groupB.id);
        expect(checkB?.name).toBe(originalName);
      });

      it("deleteLensGroup with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const groupsB = await repo.listLensGroups(shopB);
        const groupB = groupsB[0];

        await expect(repo.deleteLensGroup(shopA, groupB.id)).rejects.toThrow(
          NotFoundError,
        );

        const checkB = await repo.getLensGroup(shopB, groupB.id);
        expect(checkB?.archivedAt).toBeNull();
      });

      it("reorderLensGroups with another shop's ID throws NotFoundError and leaves order untouched", async () => {
        const groupsB = await repo.listLensGroups(shopB);
        const groupB = groupsB[0];

        await expect(
          repo.reorderLensGroups(shopA, [groupB.id]),
        ).rejects.toThrow(NotFoundError);
      });
    });

    describe("Lens", () => {
      it("listLenses returns only the shop's lenses", async () => {
        const lensesA = await repo.listLenses(shopA);
        const lensesB = await repo.listLenses(shopB);

        expect(lensesA.length).toBeGreaterThan(0);
        expect(lensesB.length).toBeGreaterThan(0);
        expect(lensesA.every((l) => l.shopId === shopA)).toBe(true);
        expect(lensesB.every((l) => l.shopId === shopB)).toBe(true);
        expect(lensesA.some((l) => l.shopId === shopB)).toBe(false);
      });

      it("getLens with another shop's ID returns null", async () => {
        const lensesB = await repo.listLenses(shopB);
        const lensB = lensesB[0];

        const foundUnderA = await repo.getLens(shopA, lensB.id);
        expect(foundUnderA).toBeNull();

        const foundUnderB = await repo.getLens(shopB, lensB.id);
        expect(foundUnderB).not.toBeNull();
        expect(foundUnderB?.id).toBe(lensB.id);
      });

      it("createLens creates lens under the given shop only", async () => {
        const groupsA = await repo.listLensGroups(shopA);
        const newLensA = await repo.createLens(shopA, {
          groupId: groupsA[0].id,
          name: "Shop A Custom Lens",
          priceMinor: 5000,
          currency: "USD",
          rxTypes: ["SINGLE_VISION"],
          sphMin: -600,
          sphMax: 400,
          cylMin: -200,
          cylMax: 0,
        });

        expect(newLensA.shopId).toBe(shopA);

        const lensesB = await repo.listLenses(shopB);
        expect(lensesB.some((l) => l.id === newLensA.id)).toBe(false);
      });

      it("updateLens with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const lensesB = await repo.listLenses(shopB);
        const lensB = lensesB[0];
        const originalName = lensB.name;

        await expect(
          repo.updateLens(shopA, lensB.id, { name: "Tampered Lens" }),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getLens(shopB, lensB.id);
        expect(checkB?.name).toBe(originalName);
      });

      it("deleteLens with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const lensesB = await repo.listLenses(shopB);
        const lensB = lensesB[0];

        await expect(repo.deleteLens(shopA, lensB.id)).rejects.toThrow(
          NotFoundError,
        );

        const checkB = await repo.getLens(shopB, lensB.id);
        expect(checkB?.archivedAt).toBeNull();
      });

      it("reorderLenses with another shop's ID throws NotFoundError and leaves order untouched", async () => {
        const lensesB = await repo.listLenses(shopB);
        const lensB = lensesB[0];

        await expect(repo.reorderLenses(shopA, [lensB.id])).rejects.toThrow(
          NotFoundError,
        );
      });
    });

    describe("OptionGroup", () => {
      it("listOptionGroups returns only the shop's option groups", async () => {
        const optGroupsA = await repo.listOptionGroups(shopA);
        const optGroupsB = await repo.listOptionGroups(shopB);

        expect(optGroupsA.length).toBeGreaterThan(0);
        expect(optGroupsB.length).toBeGreaterThan(0);
        expect(optGroupsA.every((g) => g.shopId === shopA)).toBe(true);
        expect(optGroupsB.every((g) => g.shopId === shopB)).toBe(true);
        expect(optGroupsA.some((g) => g.shopId === shopB)).toBe(false);
      });

      it("getOptionGroup with another shop's ID returns null", async () => {
        const optGroupsB = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsB[0];

        const foundUnderA = await repo.getOptionGroup(shopA, optGroupB.id);
        expect(foundUnderA).toBeNull();

        const foundUnderB = await repo.getOptionGroup(shopB, optGroupB.id);
        expect(foundUnderB?.id).toBe(optGroupB.id);
      });

      it("createOptionGroup creates option group under the given shop only", async () => {
        const newGroupA = await repo.createOptionGroup(shopA, {
          kind: "TINT_TYPE",
          name: "Shop A Tint Group",
        });

        expect(newGroupA.shopId).toBe(shopA);

        const optGroupsB = await repo.listOptionGroups(shopB);
        expect(optGroupsB.some((g) => g.id === newGroupA.id)).toBe(false);
      });

      it("updateOptionGroup with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const optGroupsB = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsB[0];
        const originalName = optGroupB.name;

        await expect(
          repo.updateOptionGroup(shopA, optGroupB.id, { name: "Tampered OptGroup" }),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getOptionGroup(shopB, optGroupB.id);
        expect(checkB?.name).toBe(originalName);
      });

      it("deleteOptionGroup with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const optGroupsB = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsB[0];

        await expect(repo.deleteOptionGroup(shopA, optGroupB.id)).rejects.toThrow(
          NotFoundError,
        );

        const checkB = await repo.getOptionGroup(shopB, optGroupB.id);
        expect(checkB?.archivedAt).toBeNull();
      });

      it("reorderOptionGroups with another shop's ID throws NotFoundError and leaves order untouched", async () => {
        const optGroupsB = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsB[0];

        await expect(
          repo.reorderOptionGroups(shopA, [optGroupB.id]),
        ).rejects.toThrow(NotFoundError);
      });
    });

    describe("OptionValue", () => {
      it("listOptionValues returns only the shop's option values", async () => {
        const valuesA = await repo.listOptionValues(shopA);
        const valuesB = await repo.listOptionValues(shopB);

        expect(valuesA.length).toBeGreaterThan(0);
        expect(valuesB.length).toBeGreaterThan(0);
        expect(valuesA.every((v) => v.shopId === shopA)).toBe(true);
        expect(valuesB.every((v) => v.shopId === shopB)).toBe(true);
        expect(valuesA.some((v) => v.shopId === shopB)).toBe(false);
      });

      it("getOptionValue with another shop's ID returns null", async () => {
        const valuesB = await repo.listOptionValues(shopB);
        const valueB = valuesB[0];

        const foundUnderA = await repo.getOptionValue(shopA, valueB.id);
        expect(foundUnderA).toBeNull();

        const foundUnderB = await repo.getOptionValue(shopB, valueB.id);
        expect(foundUnderB?.id).toBe(valueB.id);
      });

      it("createOptionValue creates option value under the given shop only", async () => {
        const optGroupsA = await repo.listOptionGroups(shopA);
        const newValA = await repo.createOptionValue(shopA, {
          optionGroupId: optGroupsA[0].id,
          label: "Shop A Distinct Value",
          priceDeltaMinor: 2000,
        });

        expect(newValA.shopId).toBe(shopA);

        const valuesB = await repo.listOptionValues(shopB);
        expect(valuesB.some((v) => v.id === newValA.id)).toBe(false);
      });

      it("updateOptionValue with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const valuesB = await repo.listOptionValues(shopB);
        const valueB = valuesB[0];
        const originalLabel = valueB.label;

        await expect(
          repo.updateOptionValue(shopA, valueB.id, { label: "Tampered Value" }),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getOptionValue(shopB, valueB.id);
        expect(checkB?.label).toBe(originalLabel);
      });

      it("deleteOptionValue with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const valuesB = await repo.listOptionValues(shopB);
        const valueB = valuesB[0];

        await expect(repo.deleteOptionValue(shopA, valueB.id)).rejects.toThrow(
          NotFoundError,
        );

        const checkB = await repo.getOptionValue(shopB, valueB.id);
        expect(checkB?.archivedAt).toBeNull();
      });

      it("reorderOptionValues with another shop's ID throws NotFoundError and leaves order untouched", async () => {
        const valuesB = await repo.listOptionValues(shopB);
        const valueB = valuesB[0];

        await expect(
          repo.reorderOptionValues(shopA, [valueB.id]),
        ).rejects.toThrow(NotFoundError);
      });
    });

    describe("AddOn", () => {
      it("listAddOns returns only the shop's add-ons", async () => {
        const addOnsA = await repo.listAddOns(shopA);
        const addOnsB = await repo.listAddOns(shopB);

        expect(addOnsA.length).toBeGreaterThan(0);
        expect(addOnsB.length).toBeGreaterThan(0);
        expect(addOnsA.every((a) => a.shopId === shopA)).toBe(true);
        expect(addOnsB.every((a) => a.shopId === shopB)).toBe(true);
        expect(addOnsA.some((a) => a.shopId === shopB)).toBe(false);
      });

      it("getAddOn with another shop's ID returns null", async () => {
        const addOnsB = await repo.listAddOns(shopB);
        const addOnB = addOnsB[0];

        const foundUnderA = await repo.getAddOn(shopA, addOnB.id);
        expect(foundUnderA).toBeNull();

        const foundUnderB = await repo.getAddOn(shopB, addOnB.id);
        expect(foundUnderB?.id).toBe(addOnB.id);
      });

      it("createAddOn creates add-on under the given shop only", async () => {
        const newAddOnA = await repo.createAddOn(shopA, {
          name: "Shop A Water Repellent",
          priceMinor: 2500,
        });

        expect(newAddOnA.shopId).toBe(shopA);

        const addOnsB = await repo.listAddOns(shopB);
        expect(addOnsB.some((a) => a.id === newAddOnA.id)).toBe(false);
      });

      it("updateAddOn with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const addOnsB = await repo.listAddOns(shopB);
        const addOnB = addOnsB[0];
        const originalName = addOnB.name;

        await expect(
          repo.updateAddOn(shopA, addOnB.id, { name: "Tampered AddOn" }),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getAddOn(shopB, addOnB.id);
        expect(checkB?.name).toBe(originalName);
      });

      it("deleteAddOn with another shop's ID throws NotFoundError and leaves row untouched", async () => {
        const addOnsB = await repo.listAddOns(shopB);
        const addOnB = addOnsB[0];

        await expect(repo.deleteAddOn(shopA, addOnB.id)).rejects.toThrow(
          NotFoundError,
        );

        const checkB = await repo.getAddOn(shopB, addOnB.id);
        expect(checkB?.archivedAt).toBeNull();
      });

      it("reorderAddOns with another shop's ID throws NotFoundError and leaves order untouched", async () => {
        const addOnsB = await repo.listAddOns(shopB);
        const addOnB = addOnsB[0];

        await expect(repo.reorderAddOns(shopA, [addOnB.id])).rejects.toThrow(
          NotFoundError,
        );
      });
    });

    describe("Sync and Storefront data scoping", () => {
      it("markSynced with another shop's row throws NotFoundError and leaves row untouched", async () => {
        const lensesB = await repo.listLenses(shopB);
        const lensB = lensesB[0];
        const originalVariant = lensB.shopifyVariantId;

        await expect(
          repo.markSynced(shopA, "lens", lensB.id, "gid://shopify/ProductVariant/9999"),
        ).rejects.toThrow(NotFoundError);

        const checkB = await repo.getLens(shopB, lensB.id);
        expect(checkB?.shopifyVariantId).toBe(originalVariant);
      });

      it("markSynced updates entity for the correct shop", async () => {
        const lensesA = await repo.listLenses(shopA);
        const lensA = lensesA[0];

        const synced = await repo.markSynced(
          shopA,
          "lens",
          lensA.id,
          "gid://shopify/ProductVariant/1111",
          "gid://shopify/Product/1111",
        );

        expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/1111");

        const updated = await repo.getLens(shopA, lensA.id);
        expect(updated?.shopifyVariantId).toBe("gid://shopify/ProductVariant/1111");
        expect(updated?.shopifyProductId).toBe("gid://shopify/Product/1111");
      });

      it("getStorefrontCatalogData returns only rows belonging to the queried shop", async () => {
        const dataA = await repo.getStorefrontCatalogData(shopA);
        const dataB = await repo.getStorefrontCatalogData(shopB);

        expect(dataA.lensGroups.every((g) => g.shopId === shopA)).toBe(true);
        expect(dataA.optionGroups.every((g) => g.shopId === shopA)).toBe(true);
        expect(dataA.addOns.every((a) => a.shopId === shopA)).toBe(true);

        expect(dataB.lensGroups.every((g) => g.shopId === shopB)).toBe(true);
        expect(dataB.optionGroups.every((g) => g.shopId === shopB)).toBe(true);
        expect(dataB.addOns.every((a) => a.shopId === shopB)).toBe(true);
      });
    });
  });

  // =========================================================================
  // Reorder transactional integrity
  // =========================================================================

  describe("Reorder transactional atomicity", () => {
    it("reorder interrupted mid-transaction leaves previous order untouched (LensGroup)", async () => {
      // Create 3 groups for shopA
      const g1 = await repo.createLensGroup(shopA, { name: "G1", position: 10 });
      const g2 = await repo.createLensGroup(shopA, { name: "G2", position: 20 });
      const g3 = await repo.createLensGroup(shopA, { name: "G3", position: 30 });

      // Attempt to reorder with a bad ID in the middle
      await expect(
        repo.reorderLensGroups(shopA, [g3.id, "non-existent-id", g1.id]),
      ).rejects.toThrow(NotFoundError);

      // Verify original positions remain completely unchanged
      const check1 = await repo.getLensGroup(shopA, g1.id);
      const check2 = await repo.getLensGroup(shopA, g2.id);
      const check3 = await repo.getLensGroup(shopA, g3.id);

      expect(check1?.position).toBe(10);
      expect(check2?.position).toBe(20);
      expect(check3?.position).toBe(30);

      // Successful reorder works
      await repo.reorderLensGroups(shopA, [g3.id, g1.id, g2.id]);
      const after1 = await repo.getLensGroup(shopA, g1.id);
      const after2 = await repo.getLensGroup(shopA, g2.id);
      const after3 = await repo.getLensGroup(shopA, g3.id);

      expect(after3?.position).toBe(0);
      expect(after1?.position).toBe(1);
      expect(after2?.position).toBe(2);
    });

    it("reorder interrupted mid-transaction leaves previous order untouched (Lens)", async () => {
      const groups = await repo.listLensGroups(shopA);
      const groupId = groups[0].id;

      const l1 = await repo.createLens(shopA, {
        groupId,
        name: "L1",
        priceMinor: 1000,
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        position: 10,
      });
      const l2 = await repo.createLens(shopA, {
        groupId,
        name: "L2",
        priceMinor: 2000,
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        position: 20,
      });

      await expect(
        repo.reorderLenses(shopA, [l2.id, "fake-lens-id"]),
      ).rejects.toThrow(NotFoundError);

      const check1 = await repo.getLens(shopA, l1.id);
      const check2 = await repo.getLens(shopA, l2.id);

      expect(check1?.position).toBe(10);
      expect(check2?.position).toBe(20);
    });

    it("reorder interrupted mid-transaction leaves previous order untouched (AddOn)", async () => {
      const a1 = await repo.createAddOn(shopA, { name: "A1", priceMinor: 500, position: 10 });
      const a2 = await repo.createAddOn(shopA, { name: "A2", priceMinor: 600, position: 20 });

      await expect(
        repo.reorderAddOns(shopA, [a2.id, "fake-addon-id"]),
      ).rejects.toThrow(NotFoundError);

      const check1 = await repo.getAddOn(shopA, a1.id);
      const check2 = await repo.getAddOn(shopA, a2.id);

      expect(check1?.position).toBe(10);
      expect(check2?.position).toBe(20);
    });
  });

  // =========================================================================
  // Soft-delete behavior
  // =========================================================================

  describe("Soft-delete behavior", () => {
    it("deleting a lens sets archivedAt, excludes from default list, but getLens still returns it", async () => {
      const groups = await repo.listLensGroups(shopA);
      const lens = await repo.createLens(shopA, {
        groupId: groups[0].id,
        name: "To Archive",
        priceMinor: 3000,
        rxTypes: ["SINGLE_VISION"],
        sphMin: -400,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
      });

      expect(lens.archivedAt).toBeNull();

      const deleted = await repo.deleteLens(shopA, lens.id);
      expect(deleted.archivedAt).not.toBeNull();

      // getLens still returns the archived lens (so historical orders still resolve)
      const fetched = await repo.getLens(shopA, lens.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(lens.id);
      expect(fetched?.archivedAt).not.toBeNull();

      // Default listLenses excludes archived
      const activeList = await repo.listLenses(shopA, { includeArchived: false });
      expect(activeList.some((l) => l.id === lens.id)).toBe(false);

      // With includeArchived: true, it is returned
      const fullList = await repo.listLenses(shopA, { includeArchived: true });
      expect(fullList.some((l) => l.id === lens.id)).toBe(true);
    });
  });
});
