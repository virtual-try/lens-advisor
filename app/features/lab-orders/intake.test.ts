// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { buildBundleLineProperties } from "../../../packages/rx-core/src/cart/bundle-properties.js";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { action as ordersCreateAction } from "../../routes/webhooks.orders.create";
import { getCipher } from "../../shared/container/cipher.server";
import { defineJob, JobDefinitionError } from "../../shared/queue/define-job";
import type { Queue } from "../../shared/queue/queue";
import { getShopify } from "../../shopify.server";
import {
  createIntakeService,
  extractAttributesRecord,
  fromOrderGid,
  toOrderGid,
} from "./intake.service.server";
import {
  DISPATCH_JOB_NAME,
  dispatchJob,
  dispatchJobPayloadSchema,
  INTAKE_JOB_NAME,
  intakeJob,
  intakeJobPayloadSchema,
} from "./jobs.server";
import {
  getLabOrderById,
  getLabOrderByShopifyOrderAndBundle,
  listLabOrdersByShop,
  upsertLabOrder,
} from "./lab-orders.repository.server";

const DB_TIMEOUT = 120_000;

interface FakeQueue {
  enqueue: ReturnType<typeof vi.fn>;
}

function createFakeQueue(): FakeQueue {
  const enqueuedJobs = new Map<string, unknown>();
  const enqueue = vi.fn(
    async (name: string, payload: unknown, options?: { singletonKey?: string }) => {
      const key = options?.singletonKey ?? JSON.stringify(payload);
      if (enqueuedJobs.has(`${name}:${key}`)) {
        return null;
      }
      enqueuedJobs.set(`${name}:${key}`, payload);
      return `job_${randomUUID()}`;
    },
  );
  return { enqueue };
}

function createActionArgs(request: Request): ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: {},
    url,
    pattern: url.pathname,
  };
}

describe("Spec 23: orders/create webhook → lab orders", () => {
  let testDb: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };
  let lensA: { id: string };
  let optionVal1: { id: string };
  let optionVal2: { id: string };
  let addOn1: { id: string };

  beforeAll(async () => {
    testDb = await createTestDb();
    shopA = await seedShop(testDb.prisma, "shop-a-spec23.myshopify.com");
    shopB = await seedShop(testDb.prisma, "shop-b-spec23.myshopify.com");

    const lens = await testDb.prisma.lens.findFirst({
      where: { shopId: shopA.shopId },
    });
    if (!lens) throw new Error("Seed lens not found");
    lensA = lens;

    const optValues = await testDb.prisma.optionValue.findMany({
      where: { shopId: shopA.shopId },
    });
    optionVal1 = optValues[0];

    // Create second option value for 2 options test
    const optGroup = await testDb.prisma.optionGroup.findFirst({
      where: { shopId: shopA.shopId },
    });
    optionVal2 = await testDb.prisma.optionValue.create({
      data: {
        shopId: shopA.shopId,
        optionGroupId: optGroup!.id,
        label: "Anti-reflective",
        priceDeltaMinor: 1000,
        currency: "USD",
        position: 1,
      },
    });

    const addOn = await testDb.prisma.addOn.findFirst({
      where: { shopId: shopA.shopId },
    });
    addOn1 = addOn!;
  }, DB_TIMEOUT);

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Examples Table Tests", () => {
    it("Row 1: 1 frame + lens + 2 options, Rx in limits -> 1 LabOrder PENDING, rxOutOfLimits=false, 1 dispatch job (normal)", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const aad = `${shopA.shopId}:${prescriptionId}`;
      const validRx = {
        od: { sph: -225, cyl: -100, axis: 90 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
      };
      await testDb.prisma.prescription.create({
        data: {
          id: prescriptionId,
          shopId: shopA.shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(validRx, aad),
          uploadKeys: [],
        },
      });

      const bundleId = `bundle_${randomUUID()}`;
      const orderId = `1001_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const frameProps = buildBundleLineProperties({
        role: "frame",
        bundleId,
        storeRxInOrder: false,
      });

      const lensProps = buildBundleLineProperties({
        role: "lens",
        bundleId,
        itemId: lensA.id,
        optionIds: [optionVal1.id, optionVal2.id],
        addonIds: [addOn1.id],
        rxRef: prescriptionId,
        storeRxInOrder: false,
      });

      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: frameLineId,
              title: "Classic Aviator Frame",
              sku: "AVIATOR-01",
              customAttributes: Object.entries(frameProps).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Standard Lens",
              sku: "LENS-156",
              parentLineItem: { id: frameLineId },
              customAttributes: Object.entries(lensProps).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(1);

      const labOrder = result.labOrders[0];
      expect(labOrder.status).toBe("PENDING");
      expect(labOrder.rxOutOfLimits).toBe(false);
      expect(labOrder.prescriptionId).toBe(prescriptionId);
      expect(labOrder.lensId).toBe(lensA.id);
      expect(labOrder.frameTitle).toBe("Classic Aviator Frame");
      expect(labOrder.frameSku).toBe("AVIATOR-01");
      expect(labOrder.optionValueIds).toContain(optionVal1.id);
      expect(labOrder.optionValueIds).toContain(optionVal2.id);
      expect(labOrder.addOnIds).toContain(addOn1.id);
      expect(labOrder.lastErrorCode).toBeNull();

      // Assert exactly 1 dispatch job enqueued
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: labOrder.id },
        { singletonKey: labOrder.id },
      );

      // Verify attachOrder was called and stored on prescription
      const updatedRx = await testDb.prisma.prescription.findUnique({
        where: { id: prescriptionId },
      });
      expect(updatedRx?.orderId).toBe(orderId);
    });

    it("Row 2: 2 bundles in one order -> 2 LabOrders, 2 jobs (multi)", async () => {
      const cipher = getCipher();
      const rxId1 = randomUUID();
      const rxId2 = randomUUID();
      const validRx = {
        od: { sph: -200, cyl: 0, axis: 180 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 620 },
      };

      await testDb.prisma.prescription.createMany({
        data: [
          {
            id: rxId1,
            shopId: shopA.shopId,
            rxType: "SINGLE_VISION",
            source: "MANUAL",
            cipher: cipher.encrypt(validRx, `${shopA.shopId}:${rxId1}`),
            uploadKeys: [],
          },
          {
            id: rxId2,
            shopId: shopA.shopId,
            rxType: "SINGLE_VISION",
            source: "MANUAL",
            cipher: cipher.encrypt(validRx, `${shopA.shopId}:${rxId2}`),
            uploadKeys: [],
          },
        ],
      });

      const orderId = `1002_${randomUUID()}`;
      const bundle1 = `b1_${randomUUID()}`;
      const bundle2 = `b2_${randomUUID()}`;

      const frame1Id = `gid://shopify/LineItem/${randomUUID()}`;
      const frame2Id = `gid://shopify/LineItem/${randomUUID()}`;

      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            // Bundle 1 lines
            {
              id: frame1Id,
              title: "Wayfarer Black",
              sku: "WAY-BLK",
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "frame",
                  bundleId: bundle1,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Lens Bundle 1",
              parentLineItem: { id: frame1Id },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId: bundle1,
                  itemId: lensA.id,
                  rxRef: rxId1,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            // Bundle 2 lines
            {
              id: frame2Id,
              title: "Round Tortoise",
              sku: "RND-TOR",
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "frame",
                  bundleId: bundle2,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Lens Bundle 2",
              parentLineItem: { id: frame2Id },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId: bundle2,
                  itemId: lensA.id,
                  rxRef: rxId2,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(2);

      const orderB1 = result.labOrders.find((o) => o.bundleId === bundle1);
      const orderB2 = result.labOrders.find((o) => o.bundleId === bundle2);

      expect(orderB1).toBeDefined();
      expect(orderB2).toBeDefined();
      expect(orderB1?.frameTitle).toBe("Wayfarer Black");
      expect(orderB2?.frameTitle).toBe("Round Tortoise");

      // Assert exactly 2 dispatch jobs enqueued (one for each LabOrder)
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: orderB1!.id },
        { singletonKey: orderB1!.id },
      );
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: orderB2!.id },
        { singletonKey: orderB2!.id },
      );
    });

    it("Row 3: same webhook delivered twice -> still 1 LabOrder per bundle, 1 job each (INV-8)", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const validRx = {
        od: { sph: -150, cyl: 0, axis: 180 },
        os: { sph: -150, cyl: 0, axis: 180 },
        pd: { single: 640 },
      };
      await testDb.prisma.prescription.create({
        data: {
          id: prescriptionId,
          shopId: shopA.shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(validRx, `${shopA.shopId}:${prescriptionId}`),
          uploadKeys: [],
        },
      });

      const orderId = `1003_${randomUUID()}`;
      const bundleId = `b_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: frameLineId,
              title: "Titanium Frame",
              sku: "TITAN-01",
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "frame",
                  bundleId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Lens",
              parentLineItem: { id: frameLineId },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId,
                  itemId: lensA.id,
                  rxRef: prescriptionId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      // First delivery
      const res1 = await service.processOrderIntake(shopA.shopId, orderId);
      expect(res1.ok).toBe(true);
      expect(res1.labOrders).toHaveLength(1);
      const initialLabOrderId = res1.labOrders[0].id;

      // Second delivery with identical input
      const res2 = await service.processOrderIntake(shopA.shopId, orderId);
      expect(res2.ok).toBe(true);
      expect(res2.labOrders).toHaveLength(1);
      expect(res2.labOrders[0].id).toBe(initialLabOrderId);

      // Verify in DB that only 1 row exists
      const rowsInDb = await testDb.prisma.labOrder.findMany({
        where: {
          shopId: shopA.shopId,
          shopifyOrderId: orderId,
          bundleId,
        },
      });
      expect(rowsInDb).toHaveLength(1);

      // Verify that the queue dropped the duplicate singleton key
      // The first call enqueued 1 job; the second enqueue resolved to null
      const results = await Promise.all(fakeQueue.enqueue.mock.results.map((r) => r.value));
      const nonNullEnqueues = results.filter((val) => val !== null);
      expect(nonNullEnqueues).toHaveLength(1);
    });

    it("Row 4: Rx SPH −9.00, lens min −8.00 -> rxOutOfLimits=true, still dispatched (flag, not block)", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      // lensA sphMin is -800 (-8.00 D). SPH -9.00 D (-900) exceeds min limit.
      const outOfLimitsRx = {
        od: { sph: -900, cyl: 0, axis: 90 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
      };
      await testDb.prisma.prescription.create({
        data: {
          id: prescriptionId,
          shopId: shopA.shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(outOfLimitsRx, `${shopA.shopId}:${prescriptionId}`),
          uploadKeys: [],
        },
      });

      const orderId = `1004_${randomUUID()}`;
      const bundleId = `b_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: frameLineId,
              title: "Metal Frame",
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "frame",
                  bundleId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Lens",
              parentLineItem: { id: frameLineId },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId,
                  itemId: lensA.id,
                  rxRef: prescriptionId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(1);

      const labOrder = result.labOrders[0];
      // Flag, not block: rxOutOfLimits is true, but status is still PENDING and dispatched
      expect(labOrder.rxOutOfLimits).toBe(true);
      expect(labOrder.status).toBe("PENDING");
      expect(labOrder.prescriptionId).toBe(prescriptionId);

      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: labOrder.id },
        { singletonKey: labOrder.id },
      );
    });

    it("Row 5: _rx_ref of shop B in shop A's order -> FAILED RX_NOT_FOUND, no dispatch (INV-1)", async () => {
      const cipher = getCipher();
      // Prescription created for Shop B
      const shopBPrescriptionId = randomUUID();
      const rxShopB = {
        od: { sph: -100, cyl: 0, axis: 180 },
        os: { sph: -100, cyl: 0, axis: 180 },
        pd: { single: 630 },
      };
      await testDb.prisma.prescription.create({
        data: {
          id: shopBPrescriptionId,
          shopId: shopB.shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(rxShopB, `${shopB.shopId}:${shopBPrescriptionId}`),
          uploadKeys: [],
        },
      });

      const orderId = `1005_${randomUUID()}`;
      const bundleId = `b_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      // Shop A's order attempts to use Shop B's prescription ID
      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: frameLineId,
              title: "Frame Line",
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "frame",
                  bundleId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "Lens Line",
              parentLineItem: { id: frameLineId },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId,
                  itemId: lensA.id,
                  rxRef: shopBPrescriptionId, // Cross-shop reference!
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(1);

      const labOrder = result.labOrders[0];
      expect(labOrder.prescriptionId).toBeNull();
      expect(labOrder.status).toBe("FAILED");
      expect(labOrder.lastErrorCode).toBe("RX_NOT_FOUND");
      expect(labOrder.rxOutOfLimits).toBe(false);

      // NO dispatch job should be enqueued
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();

      // Ensure Shop B's prescription was NOT updated
      const shopBRx = await testDb.prisma.prescription.findUnique({
        where: { id: shopBPrescriptionId },
      });
      expect(shopBRx?.orderId).toBeNull();
    });

    it("Row 6: order with no bundle lines -> nothing written (unrelated order)", async () => {
      const orderId = `1006_${randomUUID()}`;
      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "Cleaning Cloth",
              sku: "CLOTH-01",
              customAttributes: [],
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "Eyewear Case",
              sku: "CASE-01",
              customAttributes: [
                { key: "color", value: "black" },
              ],
            },
          ],
        },
      };

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const countBefore = await testDb.prisma.labOrder.count({
        where: { shopId: shopA.shopId },
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(0);

      const countAfter = await testDb.prisma.labOrder.count({
        where: { shopId: shopA.shopId },
      });
      expect(countAfter).toBe(countBefore);
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    });

    it("Row 7: invalid HMAC -> 401, nothing enqueued (INV-6)", async () => {
      const request = new Request("https://example.com/webhooks/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Hmac-Sha256": "invalid_hmac_signature",
          "X-Shopify-Shop-Domain": shopA.domain,
          "X-Shopify-Topic": "orders/create",
        },
        body: JSON.stringify({ id: 1007 }),
      });

      // Mock authenticate.webhook to throw 401 when signature is invalid
      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      );

      const response = await ordersCreateAction(createActionArgs(request));

      expect(response.status).toBe(401);
    });
  });

  describe("INV-1: Multi-tenant Shop Scoping", () => {
    it("Repository functions strictly filter by shopId across two shops", async () => {
      const shopifyOrderId = `order_${randomUUID()}`;
      const bundleA = `bundle_a_${randomUUID()}`;
      const bundleB = `bundle_b_${randomUUID()}`;

      // Get lens for shop B
      const lensB = await testDb.prisma.lens.findFirst({
        where: { shopId: shopB.shopId },
      });
      expect(lensB).toBeDefined();

      // 1. upsertLabOrder for Shop A
      const orderA = await upsertLabOrder(testDb.prisma, shopA.shopId, {
        shopifyOrderId,
        orderName: "#100A",
        bundleId: bundleA,
        lensId: lensA.id,
        frameTitle: "Shop A Frame",
      });

      // 2. upsertLabOrder for Shop B
      const orderB = await upsertLabOrder(testDb.prisma, shopB.shopId, {
        shopifyOrderId,
        orderName: "#100B",
        bundleId: bundleB,
        lensId: lensB!.id,
        frameTitle: "Shop B Frame",
      });

      expect(orderA.shopId).toBe(shopA.shopId);
      expect(orderB.shopId).toBe(shopB.shopId);

      // 3. getLabOrderById
      // Requesting Shop A's order with Shop B's ID returns null
      const crossShopRead = await getLabOrderById(testDb.prisma, shopB.shopId, orderA.id);
      expect(crossShopRead).toBeNull();

      // Requesting Shop A's order with Shop A's ID succeeds
      const sameShopRead = await getLabOrderById(testDb.prisma, shopA.shopId, orderA.id);
      expect(sameShopRead).not.toBeNull();
      expect(sameShopRead?.id).toBe(orderA.id);

      // 4. getLabOrderByShopifyOrderAndBundle
      const crossBundleRead = await getLabOrderByShopifyOrderAndBundle(
        testDb.prisma,
        shopB.shopId,
        shopifyOrderId,
        bundleA,
      );
      expect(crossBundleRead).toBeNull();

      const sameBundleRead = await getLabOrderByShopifyOrderAndBundle(
        testDb.prisma,
        shopA.shopId,
        shopifyOrderId,
        bundleA,
      );
      expect(sameBundleRead).not.toBeNull();
      expect(sameBundleRead?.bundleId).toBe(bundleA);

      // 5. listLabOrdersByShop
      const shopAList = await listLabOrdersByShop(testDb.prisma, shopA.shopId);
      const shopBList = await listLabOrdersByShop(testDb.prisma, shopB.shopId);

      expect(shopAList.some((o) => o.id === orderA.id)).toBe(true);
      expect(shopAList.some((o) => o.id === orderB.id)).toBe(false);

      expect(shopBList.some((o) => o.id === orderB.id)).toBe(true);
      expect(shopBList.some((o) => o.id === orderA.id)).toBe(false);
    });
  });

  describe("INV-2: Prescription Privacy and Encryption", () => {
    it("Job payload schemas hold IDs only (spec 08 guard)", () => {
      // Test intakeJob and dispatchJob schemas
      expect(intakeJob.name).toBe(INTAKE_JOB_NAME);
      expect(dispatchJob.name).toBe(DISPATCH_JOB_NAME);

      const validIntakePayload = {
        shopId: "shop_123",
        shopifyOrderId: "1001",
      };
      expect(intakeJobPayloadSchema.parse(validIntakePayload)).toEqual(validIntakePayload);

      const validDispatchPayload = {
        labOrderId: "order_123",
      };
      expect(dispatchJobPayloadSchema.parse(validDispatchPayload)).toEqual(validDispatchPayload);

      // Verify that defineJob throws if a schema contains an Rx string field (INV-2 guard)
      expect(() => {
        defineJob({
          name: "test.invalid.rx",
          schema: z.object({
            sph: z.string(),
          }),
          handler: () => {},
        });
      }).toThrowError(JobDefinitionError);
    });

    it("LabOrder table schema in Prisma DMMF contains zero Rx diopter columns", () => {
      const labOrderModel = Prisma.dmmf.datamodel.models.find(
        (m) => m.name === "LabOrder",
      );
      expect(labOrderModel).toBeDefined();

      const fieldNames = labOrderModel!.fields.map((f) => f.name.toLowerCase());
      const forbiddenRxFields = ["sph", "cyl", "axis", "add", "pd", "prism", "notes"];

      for (const field of forbiddenRxFields) {
        expect(fieldNames).not.toContain(field);
      }
    });

    it("Decrypted Rx is never logged during intake processing", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const uniqueSecretSph = -575; // Distinct value: SPH -5.75
      const secretRx = {
        od: { sph: uniqueSecretSph, cyl: 0, axis: 180 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
      };

      await testDb.prisma.prescription.create({
        data: {
          id: prescriptionId,
          shopId: shopA.shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(secretRx, `${shopA.shopId}:${prescriptionId}`),
          uploadKeys: [],
        },
      });

      const orderId = `1008_${randomUUID()}`;
      const bundleId = `b_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const fakeOrder = {
        id: `gid://shopify/Order/${orderId}`,
        name: `#${orderId}`,
        lineItems: {
          nodes: [
            {
              id: frameLineId,
              title: "Frame",
              customAttributes: Object.entries(
                buildBundleLineProperties({ role: "frame", bundleId, storeRxInOrder: false }),
              ).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "Lens",
              parentLineItem: { id: frameLineId },
              customAttributes: Object.entries(
                buildBundleLineProperties({
                  role: "lens",
                  bundleId,
                  itemId: lensA.id,
                  rxRef: prescriptionId,
                  storeRxInOrder: false,
                }),
              ).map(([key, value]) => ({ key, value })),
            },
          ],
        },
      };

      const logSpy = vi.spyOn(console, "log");
      const errorSpy = vi.spyOn(console, "error");
      const warnSpy = vi.spyOn(console, "warn");

      const fakeQueue = createFakeQueue();
      const fakeAdmin = {
        graphql: vi.fn(async () => ({ data: { order: fakeOrder } })),
      };

      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      await service.processOrderIntake(shopA.shopId, orderId);

      const allLogs = [
        ...logSpy.mock.calls,
        ...errorSpy.mock.calls,
        ...warnSpy.mock.calls,
      ].flat().map(String).join(" ");

      expect(allLogs).not.toContain("-5.75");
      expect(allLogs).not.toContain("-575");
    });
  });

  describe("INV-8 & Self-check 1: Route does no DB or Admin API work", () => {
    it("Route handler does not call DB or Admin API and enqueues job with singleton key", async () => {
      const shopifyOrderId = "8209829119";
      const request = new Request("https://example.com/webhooks/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shopA.domain,
          "X-Shopify-Topic": "orders/create",
        },
        body: JSON.stringify({ id: 8209829119, name: "#1009" }),
      });

      vi.spyOn(getShopify().authenticate, "webhook").mockResolvedValueOnce({
        shop: shopA.domain,
        topic: "orders/create",
        webhookId: "wh_123",
        payload: { id: 8209829119, name: "#1009" },
        apiVersion: "2026-10",
        webhookType: "webhooks" as const,
        session: undefined,
        admin: undefined,
      });

      // Spy on container DB and Admin API access to ensure ZERO DB/Admin API calls happen inside route (INV-8, Self-check 1)
      const prismaContainer = await import("../../shared/container/prisma.server");
      const getPrismaSpy = vi.spyOn(prismaContainer, "getPrisma");

      const unauthAdminSpy = vi.spyOn(getShopify().unauthenticated, "admin");

      const fakeQueue = createFakeQueue();
      const queueModule = await import("../../shared/container/queue.server");
      vi.spyOn(queueModule, "getQueue").mockResolvedValueOnce(fakeQueue as unknown as Queue);

      const response = await ordersCreateAction(createActionArgs(request));

      expect(response.status).toBe(200);

      // Verify ZERO DB calls and ZERO Admin API calls inside the route (INV-8, Self-check 1)
      expect(getPrismaSpy).not.toHaveBeenCalled();
      expect(unauthAdminSpy).not.toHaveBeenCalled();

      // Verify enqueue was called with orderId as singletonKey
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        INTAKE_JOB_NAME,
        {
          shopId: shopA.domain,
          shopifyOrderId,
        },
        {
          singletonKey: shopifyOrderId,
        },
      );
    });
  });

  describe("Self-check 2: Atomic Upsert on Unique Key", () => {
    it("Concurrent upsert calls on the same unique key create exactly one row", async () => {
      const shopifyOrderId = `order_${randomUUID()}`;
      const bundleId = `bundle_${randomUUID()}`;

      const input = {
        shopifyOrderId,
        orderName: "#CONCURRENT",
        bundleId,
        lensId: lensA.id,
        frameTitle: "Concurrent Frame",
      };

      // Fire two concurrent upserts
      const [res1, res2] = await Promise.all([
        upsertLabOrder(testDb.prisma, shopA.shopId, input),
        upsertLabOrder(testDb.prisma, shopA.shopId, input),
      ]);

      expect(res1.id).toBe(res2.id);

      const rows = await testDb.prisma.labOrder.findMany({
        where: {
          shopId: shopA.shopId,
          shopifyOrderId,
          bundleId,
        },
      });

      expect(rows).toHaveLength(1);
    });
  });

  describe("Intake Service Helpers", () => {
    it("toOrderGid and fromOrderGid convert correctly", () => {
      expect(toOrderGid("12345")).toBe("gid://shopify/Order/12345");
      expect(toOrderGid("gid://shopify/Order/12345")).toBe("gid://shopify/Order/12345");
      expect(fromOrderGid("gid://shopify/Order/12345")).toBe("12345");
      expect(fromOrderGid("12345")).toBe("12345");
    });

    it("extractAttributesRecord handles multiple formats", () => {
      const itemWithCustomAttrs = {
        customAttributes: [
          { key: "_bundle_id", value: "b1" },
          { name: "_bundle_role", value: "lens" },
        ],
      };
      expect(extractAttributesRecord(itemWithCustomAttrs)).toEqual({
        _bundle_id: "b1",
        _bundle_role: "lens",
      });

      const itemWithPropertiesObj = {
        properties: {
          _bundle_id: "b2",
        },
      };
      expect(extractAttributesRecord(itemWithPropertiesObj)).toEqual({
        _bundle_id: "b2",
      });
    });
  });
});
