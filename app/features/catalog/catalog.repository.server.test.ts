import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { NotFoundError } from "../../shared/http/errors.server";
import {
  createCatalogRepository,
  type CatalogRepository,
} from "./catalog.repository.server";

function createFailingClient(
  prisma: PrismaClient,
  modelName: "lensGroup" | "lens" | "optionGroup" | "optionValue" | "addOn",
  failOnUpdateIndex = 2,
): PrismaClient {
  let updateCount = 0;
  function wrap(targetClient: object): PrismaClient {
    return new Proxy(targetClient, {
      get(target: Record<string, unknown>, prop: string | symbol) {
        if (prop === "$transaction" && typeof target.$transaction === "function") {
          const rawTx = (target.$transaction as (arg: unknown) => Promise<unknown>).bind(target);
          return async (arg: unknown) => {
            if (typeof arg === "function") {
              return rawTx(async (tx: unknown) => (arg as (client: unknown) => unknown)(wrap(tx as object)));
            }
            return rawTx(arg);
          };
        }
        if (prop === modelName) {
          const modelObj = target[modelName] as Record<string, unknown>;
          return new Proxy(modelObj, {
            get(modelTarget: Record<string, unknown>, modelProp: string | symbol) {
              if (modelProp === "update") {
                return async (...args: unknown[]) => {
                  updateCount++;
                  if (updateCount === failOnUpdateIndex) {
                    throw new Error("Simulated database failure mid-transaction");
                  }
                  const updateFn = modelTarget.update as (...a: unknown[]) => Promise<unknown>;
                  return updateFn(...args);
                };
              }
              return Reflect.get(modelTarget, modelProp);
            },
          });
        }
        const value = Reflect.get(target, prop);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    }) as unknown as PrismaClient;
  }
  return wrap(prisma);
}

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
        const groupsBBefore = await repo.listLensGroups(shopB);
        const groupB = groupsBBefore[0];

        await expect(
          repo.reorderLensGroups(shopA, [groupB.id]),
        ).rejects.toThrow(NotFoundError);

        const groupsBAfter = await repo.listLensGroups(shopB);
        expect(groupsBAfter.map((g) => ({ id: g.id, position: g.position }))).toEqual(
          groupsBBefore.map((g) => ({ id: g.id, position: g.position })),
        );
      });

      it("reorderLensGroups in shop A leaves shop B positions completely untouched", async () => {
        const groupsA = await repo.listLensGroups(shopA);
        const groupsBBefore = await repo.listLensGroups(shopB);

        await repo.reorderLensGroups(shopA, groupsA.map((g) => g.id).reverse());

        const groupsBAfter = await repo.listLensGroups(shopB);
        expect(groupsBAfter.map((g) => ({ id: g.id, position: g.position }))).toEqual(
          groupsBBefore.map((g) => ({ id: g.id, position: g.position })),
        );
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

      it("updateLens reassigning groupId to another shop's group throws NotFoundError and leaves both shops' rows untouched", async () => {
        const lensesA = await repo.listLenses(shopA);
        const lensA = lensesA[0];
        const groupsB = await repo.listLensGroups(shopB);
        const groupB = groupsB[0];
        const originalGroupIdA = lensA.groupId;

        await expect(
          repo.updateLens(shopA, lensA.id, { groupId: groupB.id }),
        ).rejects.toThrow(NotFoundError);

        const checkA = await repo.getLens(shopA, lensA.id);
        expect(checkA?.groupId).toBe(originalGroupIdA);

        const checkGroupB = await repo.getLensGroup(shopB, groupB.id);
        expect(checkGroupB?.lenses.some((l) => l.id === lensA.id)).toBe(false);
      });

      it("updateLens with null addMin and addMax clears existing persisted ADD limits (R7-F2)", async () => {
        const lensesA = await repo.listLenses(shopA);
        const lensA = lensesA[0];

        // First set ADD limits
        const updatedWithAdd = await repo.updateLens(shopA, lensA.id, {
          addMin: 100,
          addMax: 250,
        });
        expect(updatedWithAdd.addMin).toBe(100);
        expect(updatedWithAdd.addMax).toBe(250);

        const checkWithAdd = await repo.getLens(shopA, lensA.id);
        expect(checkWithAdd?.addMin).toBe(100);
        expect(checkWithAdd?.addMax).toBe(250);

        // Now clear ADD limits by passing null
        const cleared = await repo.updateLens(shopA, lensA.id, {
          addMin: null,
          addMax: null,
        });
        expect(cleared.addMin).toBeNull();
        expect(cleared.addMax).toBeNull();

        const checkCleared = await repo.getLens(shopA, lensA.id);
        expect(checkCleared?.addMin).toBeNull();
        expect(checkCleared?.addMax).toBeNull();
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
        const lensesBBefore = await repo.listLenses(shopB);
        const lensB = lensesBBefore[0];

        await expect(repo.reorderLenses(shopA, [lensB.id])).rejects.toThrow(
          NotFoundError,
        );

        const lensesBAfter = await repo.listLenses(shopB);
        expect(lensesBAfter.map((l) => ({ id: l.id, position: l.position }))).toEqual(
          lensesBBefore.map((l) => ({ id: l.id, position: l.position })),
        );
      });

      it("reorderLenses in shop A leaves shop B positions completely untouched", async () => {
        const lensesA = await repo.listLenses(shopA);
        const lensesBBefore = await repo.listLenses(shopB);

        await repo.reorderLenses(shopA, lensesA.map((l) => l.id).reverse());

        const lensesBAfter = await repo.listLenses(shopB);
        expect(lensesBAfter.map((l) => ({ id: l.id, position: l.position }))).toEqual(
          lensesBBefore.map((l) => ({ id: l.id, position: l.position })),
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
        const optGroupsBBefore = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsBBefore[0];

        await expect(
          repo.reorderOptionGroups(shopA, [optGroupB.id]),
        ).rejects.toThrow(NotFoundError);

        const optGroupsBAfter = await repo.listOptionGroups(shopB);
        expect(optGroupsBAfter.map((g) => ({ id: g.id, position: g.position }))).toEqual(
          optGroupsBBefore.map((g) => ({ id: g.id, position: g.position })),
        );
      });

      it("reorderOptionGroups in shop A leaves shop B positions completely untouched", async () => {
        const optGroupsA = await repo.listOptionGroups(shopA);
        const optGroupsBBefore = await repo.listOptionGroups(shopB);

        await repo.reorderOptionGroups(shopA, optGroupsA.map((g) => g.id).reverse());

        const optGroupsBAfter = await repo.listOptionGroups(shopB);
        expect(optGroupsBAfter.map((g) => ({ id: g.id, position: g.position }))).toEqual(
          optGroupsBBefore.map((g) => ({ id: g.id, position: g.position })),
        );
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

      it("updateOptionValue reassigning optionGroupId to another shop's group throws NotFoundError and leaves both shops' rows untouched", async () => {
        const valuesA = await repo.listOptionValues(shopA);
        const valueA = valuesA[0];
        const optGroupsB = await repo.listOptionGroups(shopB);
        const optGroupB = optGroupsB[0];
        const originalOptGroupIdA = valueA.optionGroupId;

        await expect(
          repo.updateOptionValue(shopA, valueA.id, { optionGroupId: optGroupB.id }),
        ).rejects.toThrow(NotFoundError);

        const checkA = await repo.getOptionValue(shopA, valueA.id);
        expect(checkA?.optionGroupId).toBe(originalOptGroupIdA);

        const checkOptGroupB = await repo.getOptionGroup(shopB, optGroupB.id);
        expect(checkOptGroupB?.values.some((v) => v.id === valueA.id)).toBe(false);
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
        const valuesBBefore = await repo.listOptionValues(shopB);
        const valueB = valuesBBefore[0];

        await expect(
          repo.reorderOptionValues(shopA, [valueB.id]),
        ).rejects.toThrow(NotFoundError);

        const valuesBAfter = await repo.listOptionValues(shopB);
        expect(valuesBAfter.map((v) => ({ id: v.id, position: v.position }))).toEqual(
          valuesBBefore.map((v) => ({ id: v.id, position: v.position })),
        );
      });

      it("reorderOptionValues in shop A leaves shop B positions completely untouched", async () => {
        const valuesA = await repo.listOptionValues(shopA);
        const valuesBBefore = await repo.listOptionValues(shopB);

        await repo.reorderOptionValues(shopA, valuesA.map((v) => v.id).reverse());

        const valuesBAfter = await repo.listOptionValues(shopB);
        expect(valuesBAfter.map((v) => ({ id: v.id, position: v.position }))).toEqual(
          valuesBBefore.map((v) => ({ id: v.id, position: v.position })),
        );
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
        const addOnsBBefore = await repo.listAddOns(shopB);
        const addOnB = addOnsBBefore[0];

        await expect(repo.reorderAddOns(shopA, [addOnB.id])).rejects.toThrow(
          NotFoundError,
        );

        const addOnsBAfter = await repo.listAddOns(shopB);
        expect(addOnsBAfter.map((a) => ({ id: a.id, position: a.position }))).toEqual(
          addOnsBBefore.map((a) => ({ id: a.id, position: a.position })),
        );
      });

      it("reorderAddOns in shop A leaves shop B positions completely untouched", async () => {
        const addOnsA = await repo.listAddOns(shopA);
        const addOnsBBefore = await repo.listAddOns(shopB);

        await repo.reorderAddOns(shopA, addOnsA.map((a) => a.id).reverse());

        const addOnsBAfter = await repo.listAddOns(shopB);
        expect(addOnsBAfter.map((a) => ({ id: a.id, position: a.position }))).toEqual(
          addOnsBBefore.map((a) => ({ id: a.id, position: a.position })),
        );
      });
    });

    describe("Sync and Storefront data scoping", () => {
      describe("markSynced", () => {
        it("markSynced ('lens') with another shop's row throws NotFoundError and leaves row untouched", async () => {
          const lensesB = await repo.listLenses(shopB);
          const lensB = lensesB[0];
          const originalVariant = lensB.shopifyVariantId;

          await expect(
            repo.markSynced(shopA, "lens", lensB.id, "gid://shopify/ProductVariant/9999"),
          ).rejects.toThrow(NotFoundError);

          const checkB = await repo.getLens(shopB, lensB.id);
          expect(checkB?.shopifyVariantId).toBe(originalVariant);
        });

        it("markSynced ('lens') updates entity for the correct shop", async () => {
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

        it("markSynced ('optionValue') with another shop's row throws NotFoundError and leaves row untouched", async () => {
          const valuesB = await repo.listOptionValues(shopB);
          const valB = valuesB[0];
          const originalVariant = valB.shopifyVariantId;

          await expect(
            repo.markSynced(shopA, "optionValue", valB.id, "gid://shopify/ProductVariant/8888"),
          ).rejects.toThrow(NotFoundError);

          const checkB = await repo.getOptionValue(shopB, valB.id);
          expect(checkB?.shopifyVariantId).toBe(originalVariant);
        });

        it("markSynced ('optionValue') updates entity for the correct shop", async () => {
          const valuesA = await repo.listOptionValues(shopA);
          const valA = valuesA[0];

          const synced = await repo.markSynced(
            shopA,
            "optionValue",
            valA.id,
            "gid://shopify/ProductVariant/2222",
          );

          expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/2222");

          const updated = await repo.getOptionValue(shopA, valA.id);
          expect(updated?.shopifyVariantId).toBe("gid://shopify/ProductVariant/2222");
        });

        it("markSynced ('addOn') with another shop's row throws NotFoundError and leaves row untouched", async () => {
          const addOnsB = await repo.listAddOns(shopB);
          const addOnB = addOnsB[0];
          const originalVariant = addOnB.shopifyVariantId;

          await expect(
            repo.markSynced(shopA, "addOn", addOnB.id, "gid://shopify/ProductVariant/7777", "gid://shopify/Product/7777"),
          ).rejects.toThrow(NotFoundError);

          const checkB = await repo.getAddOn(shopB, addOnB.id);
          expect(checkB?.shopifyVariantId).toBe(originalVariant);
        });

        it("markSynced ('addOn') updates entity for the correct shop", async () => {
          const addOnsA = await repo.listAddOns(shopA);
          const addOnA = addOnsA[0];

          const synced = await repo.markSynced(
            shopA,
            "addOn",
            addOnA.id,
            "gid://shopify/ProductVariant/3333",
            "gid://shopify/Product/3333",
          );

          expect(synced.shopifyVariantId).toBe("gid://shopify/ProductVariant/3333");

          const updated = await repo.getAddOn(shopA, addOnA.id);
          expect(updated?.shopifyVariantId).toBe("gid://shopify/ProductVariant/3333");
          expect(updated?.shopifyProductId).toBe("gid://shopify/Product/3333");
        });
      });

      describe("getStorefrontCatalogData", () => {
        it("getStorefrontCatalogData returns only rows belonging to the queried shop and no shop B nested rows", async () => {
          // Sync a lens and an add-on for shop B so both shops have active storefront items
          const lensesBList = await repo.listLenses(shopB);
          await repo.markSynced(shopB, "lens", lensesBList[0].id, "gid://shopify/ProductVariant/B_LENS");
          const addOnsBList = await repo.listAddOns(shopB);
          await repo.markSynced(shopB, "addOn", addOnsBList[0].id, "gid://shopify/ProductVariant/B_ADDON");

          const dataA = await repo.getStorefrontCatalogData(shopA);
          const dataB = await repo.getStorefrontCatalogData(shopB);

          // Top level
          expect(dataA.lensGroups.length).toBeGreaterThan(0);
          expect(dataA.optionGroups.length).toBeGreaterThan(0);
          expect(dataA.addOns.length).toBeGreaterThan(0);
          expect(dataA.lensGroups.every((g) => g.shopId === shopA)).toBe(true);
          expect(dataA.optionGroups.every((g) => g.shopId === shopA)).toBe(true);
          expect(dataA.addOns.every((a) => a.shopId === shopA)).toBe(true);

          expect(dataB.lensGroups.length).toBeGreaterThan(0);
          expect(dataB.optionGroups.length).toBeGreaterThan(0);
          expect(dataB.addOns.length).toBeGreaterThan(0);
          expect(dataB.lensGroups.every((g) => g.shopId === shopB)).toBe(true);
          expect(dataB.optionGroups.every((g) => g.shopId === shopB)).toBe(true);
          expect(dataB.addOns.every((a) => a.shopId === shopB)).toBe(true);

          // Nested lenses: must all belong to shopA and contain no shop B lenses
          const lensesA = dataA.lensGroups.flatMap((g) => g.lenses);
          const lensesB = dataB.lensGroups.flatMap((g) => g.lenses);
          expect(lensesA.length).toBeGreaterThan(0);
          expect(lensesB.length).toBeGreaterThan(0);
          expect(lensesA.every((l) => l.shopId === shopA)).toBe(true);
          expect(lensesB.every((l) => l.shopId === shopB)).toBe(true);
          const lensBIds = new Set(lensesB.map((l) => l.id));
          expect(lensesA.some((l) => lensBIds.has(l.id))).toBe(false);

          // Nested option values: must all belong to shopA and contain no shop B values
          const valuesA = dataA.optionGroups.flatMap((g) => g.values);
          const valuesB = dataB.optionGroups.flatMap((g) => g.values);
          expect(valuesA.length).toBeGreaterThan(0);
          expect(valuesB.length).toBeGreaterThan(0);
          expect(valuesA.every((v) => v.shopId === shopA)).toBe(true);
          expect(valuesB.every((v) => v.shopId === shopB)).toBe(true);
          const valBIds = new Set(valuesB.map((v) => v.id));
          expect(valuesA.some((v) => valBIds.has(v.id))).toBe(false);

          // AddOns: Shop A add-ons contain no Shop B add-on ids
          const addOnBIds = new Set(dataB.addOns.map((a) => a.id));
          expect(dataA.addOns.some((a) => addOnBIds.has(a.id))).toBe(false);
          const addOnAIds = new Set(dataA.addOns.map((a) => a.id));
          expect(dataB.addOns.some((a) => addOnAIds.has(a.id))).toBe(false);
        });
      });
    });
  });

  // =========================================================================
  // Reorder transactional integrity
  // =========================================================================

  describe("Reorder transactional atomicity", () => {
    it("reorder interrupted mid-transaction rolls back position updates (LensGroup)", async () => {
      const g1 = await repo.createLensGroup(shopA, { name: "AtomicG1", position: 10 });
      const g2 = await repo.createLensGroup(shopA, { name: "AtomicG2", position: 20 });
      const g3 = await repo.createLensGroup(shopA, { name: "AtomicG3", position: 30 });

      // Injected client forces failure on 2nd update inside transaction
      const failingClient = createFailingClient(db.prisma, "lensGroup", 2);
      const failingRepo = createCatalogRepository(failingClient);

      await expect(
        failingRepo.reorderLensGroups(shopA, [g3.id, g1.id, g2.id]),
      ).rejects.toThrow("Simulated database failure mid-transaction");

      // Verify original positions remain completely unchanged because tx rolled back
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

    it("reorder interrupted mid-transaction rolls back position updates (Lens)", async () => {
      const groups = await repo.listLensGroups(shopA);
      const groupId = groups[0].id;

      const l1 = await repo.createLens(shopA, {
        groupId,
        name: "AtomicL1",
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
        name: "AtomicL2",
        priceMinor: 2000,
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        position: 20,
      });
      const l3 = await repo.createLens(shopA, {
        groupId,
        name: "AtomicL3",
        priceMinor: 3000,
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
        position: 30,
      });

      const failingClient = createFailingClient(db.prisma, "lens", 2);
      const failingRepo = createCatalogRepository(failingClient);

      await expect(
        failingRepo.reorderLenses(shopA, [l3.id, l1.id, l2.id]),
      ).rejects.toThrow("Simulated database failure mid-transaction");

      const check1 = await repo.getLens(shopA, l1.id);
      const check2 = await repo.getLens(shopA, l2.id);
      const check3 = await repo.getLens(shopA, l3.id);

      expect(check1?.position).toBe(10);
      expect(check2?.position).toBe(20);
      expect(check3?.position).toBe(30);
    });

    it("reorder interrupted mid-transaction rolls back position updates (AddOn)", async () => {
      const a1 = await repo.createAddOn(shopA, { name: "AtomicA1", priceMinor: 500, position: 10 });
      const a2 = await repo.createAddOn(shopA, { name: "AtomicA2", priceMinor: 600, position: 20 });
      const a3 = await repo.createAddOn(shopA, { name: "AtomicA3", priceMinor: 700, position: 30 });

      const failingClient = createFailingClient(db.prisma, "addOn", 2);
      const failingRepo = createCatalogRepository(failingClient);

      await expect(
        failingRepo.reorderAddOns(shopA, [a3.id, a1.id, a2.id]),
      ).rejects.toThrow("Simulated database failure mid-transaction");

      const check1 = await repo.getAddOn(shopA, a1.id);
      const check2 = await repo.getAddOn(shopA, a2.id);
      const check3 = await repo.getAddOn(shopA, a3.id);

      expect(check1?.position).toBe(10);
      expect(check2?.position).toBe(20);
      expect(check3?.position).toBe(30);
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

  describe("Archived group protection (R5-F1)", () => {
    it("createLens into an archived group throws NotFoundError (R5-F1)", async () => {
      const group = await repo.createLensGroup(shopA, { name: "Archived Group Repo R5F1" });
      await repo.deleteLensGroup(shopA, group.id);

      await expect(
        repo.createLens(shopA, {
          groupId: group.id,
          name: "Repo Lens in Archived Group",
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

    it("updateLens moving a lens into an archived group throws NotFoundError and leaves row untouched (R5-F1)", async () => {
      const activeGroup = await repo.createLensGroup(shopA, { name: "Active Source Group Repo R5F1" });
      const archivedGroup = await repo.createLensGroup(shopA, { name: "Archived Target Group Repo R5F1" });
      const lens = await repo.createLens(shopA, {
        groupId: activeGroup.id,
        name: "Repo Lens To Move R5F1",
        priceMinor: 1000,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -200,
        sphMax: 200,
        cylMin: -100,
        cylMax: 0,
      });

      await repo.deleteLensGroup(shopA, archivedGroup.id);

      await expect(
        repo.updateLens(shopA, lens.id, {
          groupId: archivedGroup.id,
        }),
      ).rejects.toThrow(NotFoundError);

      const checkLens = await repo.getLens(shopA, lens.id);
      expect(checkLens?.groupId).toBe(activeGroup.id);
    });
  });
});
