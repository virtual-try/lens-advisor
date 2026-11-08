// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import {
  attachOrder,
  createPrescription,
  findShopByDomain,
  getPrescriptionById,
  updatePrescriptionUpload,
} from "./prescriptions.repository.server";

const DB_TIMEOUT = 120_000;

describe("Prescriptions Repository (INV-1 shop scoping)", () => {
  let db: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };

  beforeAll(async () => {
    db = await createTestDb();
    shopA = await seedShop(db.prisma, "shop-a-repo.myshopify.com");
    shopB = await seedShop(db.prisma, "shop-b-repo.myshopify.com");
  }, DB_TIMEOUT);

  afterAll(async () => {
    await db?.drop();
  }, DB_TIMEOUT);

  async function snapshotShopRows(shopId: string) {
    return db.prisma.prescription.findMany({
      where: { shopId },
      orderBy: { id: "asc" },
    });
  }

  it("findShopByDomain finds existing shop and returns null for unknown", async () => {
    const foundA = await findShopByDomain(db.prisma, shopA.domain);
    expect(foundA).not.toBeNull();
    expect(foundA?.id).toBe(shopA.shopId);

    const notFound = await findShopByDomain(db.prisma, "nonexistent.myshopify.com");
    expect(notFound).toBeNull();
  });

  it("createPrescription stores row scoped to shopId and leaves Shop B untouched (INV-1)", async () => {
    const shopBBefore = await snapshotShopRows(shopB.shopId);
    expect(shopBBefore.length).toBeGreaterThan(0);

    const id = randomUUID();
    const created = await createPrescription(db.prisma, shopA.shopId, {
      id,
      rxType: "SINGLE_VISION",
      source: "MANUAL",
      cipher: "v1.fake.cipher.token.a",
      uploadKeys: [],
    });

    expect(created.id).toBe(id);
    expect(created.shopId).toBe(shopA.shopId);
    expect(created.rxType).toBe("SINGLE_VISION");
    expect(created.source).toBe("MANUAL");
    expect(created.cipher).toBe("v1.fake.cipher.token.a");
    expect(created.uploadKeys).toEqual([]);
    expect(created.orderId).toBeNull();

    // Verify raw DB row has shopA's shopId
    const raw = await db.prisma.prescription.findUnique({
      where: { id },
    });
    expect(raw?.shopId).toBe(shopA.shopId);

    // INV-1: Assert Shop B's rows are completely unchanged
    const shopBAfter = await snapshotShopRows(shopB.shopId);
    expect(shopBAfter).toEqual(shopBBefore);
  });

  it("getPrescriptionById returns row for owner shop and null for another shop (INV-1)", async () => {
    const idA = randomUUID();
    await createPrescription(db.prisma, shopA.shopId, {
      id: idA,
      rxType: "PROGRESSIVE",
      source: "MANUAL",
      cipher: "v1.cipher.a",
    });

    // Owner shop can read it
    const readA = await getPrescriptionById(db.prisma, shopA.shopId, idA);
    expect(readA).not.toBeNull();
    expect(readA?.id).toBe(idA);
    expect(readA?.shopId).toBe(shopA.shopId);

    // Another shop gets null (INV-1)
    const readB = await getPrescriptionById(db.prisma, shopB.shopId, idA);
    expect(readB).toBeNull();
  });

  it("attachOrder updates orderId for owner shop and fails for another shop (INV-1)", async () => {
    const shopBBefore = await snapshotShopRows(shopB.shopId);

    const idA = randomUUID();
    await createPrescription(db.prisma, shopA.shopId, {
      id: idA,
      rxType: "READING",
      source: "MANUAL",
      cipher: "v1.cipher.a",
    });

    // Shop B attempts to attach order to Shop A's prescription -> returns null, untouched
    const attachB = await attachOrder(db.prisma, shopB.shopId, idA, "ORDER-B-999");
    expect(attachB).toBeNull();

    // Verify row untouched
    const untouched = await getPrescriptionById(db.prisma, shopA.shopId, idA);
    expect(untouched?.orderId).toBeNull();

    // Shop A attaches order -> succeeds
    const attachA = await attachOrder(db.prisma, shopA.shopId, idA, "ORDER-A-101");
    expect(attachA).not.toBeNull();
    expect(attachA?.orderId).toBe("ORDER-A-101");

    const verified = await getPrescriptionById(db.prisma, shopA.shopId, idA);
    expect(verified?.orderId).toBe("ORDER-A-101");

    // INV-1: Assert Shop B's rows are completely unchanged
    const shopBAfter = await snapshotShopRows(shopB.shopId);
    expect(shopBAfter).toEqual(shopBBefore);
  });

  it("updatePrescriptionUpload updates upload prescription for owner shop and fails for another shop (INV-1)", async () => {
    const shopBBefore = await snapshotShopRows(shopB.shopId);

    const draftId = randomUUID();
    await createPrescription(db.prisma, shopA.shopId, {
      id: draftId,
      rxType: "SINGLE_VISION",
      source: "UPLOAD",
      cipher: "v1.draft.cipher",
      uploadKeys: [],
    });

    const newKeys = [`shops/${shopA.shopId}/rx/${draftId}/file1.png`];

    // Shop B attempts to update Shop A's draft -> returns null, untouched
    const updateB = await updatePrescriptionUpload(db.prisma, shopB.shopId, draftId, {
      rxType: "PROGRESSIVE",
      uploadKeys: ["shops/shop-b/rx/forged.png"],
    });
    expect(updateB).toBeNull();

    // Verify Shop A's draft untouched
    const untouched = await getPrescriptionById(db.prisma, shopA.shopId, draftId);
    expect(untouched?.rxType).toBe("SINGLE_VISION");
    expect(untouched?.uploadKeys).toEqual([]);

    // Shop A updates -> succeeds
    const updateA = await updatePrescriptionUpload(db.prisma, shopA.shopId, draftId, {
      rxType: "PROGRESSIVE",
      uploadKeys: newKeys,
    });
    expect(updateA).not.toBeNull();
    expect(updateA?.rxType).toBe("PROGRESSIVE");
    expect(updateA?.uploadKeys).toEqual(newKeys);

    // INV-1: Assert Shop B's rows are completely unchanged
    const shopBAfter = await snapshotShopRows(shopB.shopId);
    expect(shopBAfter).toEqual(shopBBefore);
  });
});
