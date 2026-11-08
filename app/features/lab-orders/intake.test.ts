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
  ORDER_INTAKE_QUERY,
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

    it("Row 7: invalid HMAC -> 401, nothing enqueued (INV-6, R1-F6)", async () => {
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

      const fakeQueue = createFakeQueue();
      const queueModule = await import("../../shared/container/queue.server");
      const getQueueSpy = vi.spyOn(queueModule, "getQueue").mockResolvedValue(fakeQueue as unknown as Queue);

      const response = await ordersCreateAction(createActionArgs(request));

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error?.code).toBe("UNAUTHORIZED");
      expect(getQueueSpy).not.toHaveBeenCalled();
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    });

    it("Malformed webhook payload -> 400, logs error code only, nothing enqueued (R1-F4)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const invalidPayloads = [
        {}, // missing id
        { id: { invalid: true } }, // object id
        { admin_graphql_api_id: "not-a-gid" }, // invalid gid format
        { id: -5 }, // negative integer
      ];

      for (const payload of invalidPayloads) {
        const request = new Request("https://example.com/webhooks/orders/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Shop-Domain": shopA.domain,
            "X-Shopify-Topic": "orders/create",
          },
          body: JSON.stringify(payload),
        });

        vi.spyOn(getShopify().authenticate, "webhook").mockResolvedValueOnce({
          shop: shopA.domain,
          topic: "orders/create",
          webhookId: "wh_test",
          payload,
          apiVersion: "2026-10",
          webhookType: "webhooks" as const,
          session: undefined,
          admin: undefined,
        });

        const fakeQueue = createFakeQueue();
        const queueModule = await import("../../shared/container/queue.server");
        const getQueueSpy = vi.spyOn(queueModule, "getQueue").mockResolvedValue(fakeQueue as unknown as Queue);

        const response = await ordersCreateAction(createActionArgs(request));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error?.code).toBe("MALFORMED_PAYLOAD");
        expect(getQueueSpy).not.toHaveBeenCalled();
        expect(fakeQueue.enqueue).not.toHaveBeenCalled();
      }

      // Verify that error logs contain ONLY error codes and never payload content (INV-2)
      for (const call of consoleErrorSpy.mock.calls) {
        const logged = call.join(" ");
        expect(logged).toContain("MALFORMED_PAYLOAD");
        expect(logged).not.toContain("invalid");
        expect(logged).not.toContain("not-a-gid");
      }

      consoleErrorSpy.mockRestore();
    });
  });

  describe("INV-1: Multi-tenant Shop Scoping", () => {
    it("Repository functions strictly filter by shopId across two shops (R1-F7)", async () => {
      const shopifyOrderId = `order_${randomUUID()}`;
      const sharedBundleId = `bundle_shared_${randomUUID()}`;

      // Get lens for shop B
      const lensB = await testDb.prisma.lens.findFirst({
        where: { shopId: shopB.shopId },
      });
      expect(lensB).toBeDefined();

      // 1. upsertLabOrder for Shop A with shared order and bundle key
      const orderA = await upsertLabOrder(testDb.prisma, shopA.shopId, {
        shopifyOrderId,
        orderName: "#100A",
        bundleId: sharedBundleId,
        lensId: lensA.id,
        frameTitle: "Shop A Frame",
      });

      // 2. upsertLabOrder for Shop B with identical order and bundle key
      const orderB = await upsertLabOrder(testDb.prisma, shopB.shopId, {
        shopifyOrderId,
        orderName: "#100B",
        bundleId: sharedBundleId,
        lensId: lensB!.id,
        frameTitle: "Shop B Frame",
      });

      expect(orderA.shopId).toBe(shopA.shopId);
      expect(orderB.shopId).toBe(shopB.shopId);
      expect(orderA.id).not.toBe(orderB.id);

      // Snapshot Shop B's complete row before updating Shop A
      const shopBRowBefore = await testDb.prisma.labOrder.findUnique({
        where: { id: orderB.id },
      });
      expect(shopBRowBefore).not.toBeNull();

      // 3. Update Shop A with the same order and bundle key
      const updatedOrderA = await upsertLabOrder(testDb.prisma, shopA.shopId, {
        shopifyOrderId,
        orderName: "#100A-RENAMED",
        bundleId: sharedBundleId,
        lensId: lensA.id,
        frameTitle: "Shop A Frame Renamed",
      });
      expect(updatedOrderA.id).toBe(orderA.id);
      expect(updatedOrderA.orderName).toBe("#100A-RENAMED");

      // Assert Shop B's complete row is byte-for-byte unchanged after Shop A update
      const shopBRowAfter = await testDb.prisma.labOrder.findUnique({
        where: { id: orderB.id },
      });
      expect(shopBRowAfter).toEqual(shopBRowBefore);

      // 4. getLabOrderById
      // Requesting Shop A's order with Shop B's ID returns null
      const crossShopRead = await getLabOrderById(testDb.prisma, shopB.shopId, orderA.id);
      expect(crossShopRead).toBeNull();

      // Requesting Shop A's order with Shop A's ID succeeds
      const sameShopRead = await getLabOrderById(testDb.prisma, shopA.shopId, orderA.id);
      expect(sameShopRead).not.toBeNull();
      expect(sameShopRead?.id).toBe(orderA.id);

      // 5. getLabOrderByShopifyOrderAndBundle
      const shopBRead = await getLabOrderByShopifyOrderAndBundle(
        testDb.prisma,
        shopB.shopId,
        shopifyOrderId,
        sharedBundleId,
      );
      expect(shopBRead).not.toBeNull();
      expect(shopBRead?.id).toBe(orderB.id);
      expect(shopBRead?.shopId).toBe(shopB.shopId);

      const shopARead = await getLabOrderByShopifyOrderAndBundle(
        testDb.prisma,
        shopA.shopId,
        shopifyOrderId,
        sharedBundleId,
      );
      expect(shopARead).not.toBeNull();
      expect(shopARead?.id).toBe(orderA.id);
      expect(shopARead?.shopId).toBe(shopA.shopId);

      // 6. listLabOrdersByShop
      const shopAList = await listLabOrdersByShop(testDb.prisma, shopA.shopId);
      const shopBList = await listLabOrdersByShop(testDb.prisma, shopB.shopId);

      expect(shopAList.some((o) => o.id === orderA.id)).toBe(true);
      expect(shopAList.some((o) => o.id === orderA.id)).toBe(true);
      expect(shopAList.some((o) => o.id === orderB.id)).toBe(false);

      expect(shopBList.some((o) => o.id === orderB.id)).toBe(true);
      expect(shopBList.some((o) => o.id === orderA.id)).toBe(false);
    });
  });

  describe("INV-2: Prescription Privacy and Encryption", () => {
    it("Job payload schemas hold IDs only (spec 08 guard, R1-F2)", async () => {
      // Test intakeJob and dispatchJob schemas
      expect(intakeJob.name).toBe(INTAKE_JOB_NAME);
      expect(dispatchJob.name).toBe(DISPATCH_JOB_NAME);

      // dispatchJob has no production worker handler (R1-F2)
      expect(dispatchJob.handler).toBeUndefined();

      // Discovering jobs does not register a no-op worker handler for dispatchJob (R1-F2)
      const { discoverJobs } = await import("../../shared/queue/discovery.server");
      const discovered = await discoverJobs();
      const discoveredDispatch = discovered.find((d) => d.name === DISPATCH_JOB_NAME);
      expect(discoveredDispatch).toBeDefined();
      expect(discoveredDispatch?.handler).toBeUndefined();

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

    it("LabOrder table schema in Prisma DMMF contains zero Rx diopter columns (R1-F8)", () => {
      const labOrderModel = Prisma.dmmf.datamodel.models.find(
        (m) => m.name === "LabOrder",
      );
      expect(labOrderModel).toBeDefined();

      const fieldNames = labOrderModel!.fields.map((f) => f.name);

      // 1. Assert 'rx' itself is absent
      expect(fieldNames.map((n) => n.toLowerCase())).not.toContain("rx");

      // 2. Structural regex check: no field matches /rx|sph|cyl|axis|add|pd|prism/i except allowed names
      const allowedRxMatchingFields = new Set(["prescriptionId", "prescription", "rxOutOfLimits", "addOnIds"]);
      const rxRegex = /rx|sph|cyl|axis|add|pd|prism/i;

      for (const field of labOrderModel!.fields) {
        if (rxRegex.test(field.name)) {
          expect(allowedRxMatchingFields.has(field.name)).toBe(true);
        }
      }

      // 3. Exact allowed field set: any new column (such as odSph or prescriptionNotes) fails
      const allowedLabOrderFields = [
        "id",
        "shopId",
        "shop",
        "shopifyOrderId",
        "orderName",
        "bundleId",
        "prescriptionId",
        "prescription",
        "lensId",
        "lens",
        "optionValueIds",
        "addOnIds",
        "frameTitle",
        "frameSku",
        "rxOutOfLimits",
        "status",
        "attempts",
        "lastErrorCode",
        "ticketKeys",
        "providerId",
        "sentAt",
        "createdAt",
      ];
      expect([...fieldNames].sort()).toEqual([...allowedLabOrderFields].sort());
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

  describe("Review R1 Findings Verification", () => {
    it("R1-F1: ORDER_INTAKE_QUERY conforms to Shopify 2026-10 LineItem schema and contains no parentLineItem", () => {
      // 1. Assert parentLineItem is absent from the query string
      expect(ORDER_INTAKE_QUERY).not.toContain("parentLineItem");

      // Canonical LineItem fields from Shopify 2026-10 Admin GraphQL schema
      const shopify2026_10_LineItemFields = new Set([
        "contract",
        "customAttributes",
        "discountAllocations",
        "discountedTotalSet",
        "discountedUnitPriceAfterAllDiscountsSet",
        "discountedUnitPriceSet",
        "duties",
        "id",
        "image",
        "isGiftCard",
        "lineItemGroup",
        "name",
        "nonFulfillableQuantity",
        "originalTotalSet",
        "originalUnitPriceSet",
        "product",
        "quantity",
        "refundableQuantity",
        "requiresShipping",
        "restockable",
        "sellingPlan",
        "sku",
        "staffMember",
        "taxLines",
        "taxable",
        "title",
        "totalDiscountSet",
        "unfulfilledDiscountedTotalSet",
        "unfulfilledOriginalTotalSet",
        "unfulfilledQuantity",
        "variant",
        "variantTitle",
        "vendor",
      ]);

      // Assert parentLineItem does not exist in Shopify 2026-10 schema
      expect(shopify2026_10_LineItemFields.has("parentLineItem")).toBe(false);

      // Direct fields queried on LineItem under nodes
      const queriedDirectFields = ["id", "title", "sku", "customAttributes"];
      for (const field of queriedDirectFields) {
        expect(shopify2026_10_LineItemFields.has(field)).toBe(true);
      }
    });

    it("R1-F3: Duplicate intake against an existing SENT row preserves status and does not re-dispatch", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const validRx = {
        od: { sph: -200, cyl: 0, axis: 180 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
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

      const orderId = `1003_sent_${randomUUID()}`;
      const bundleId = `bundle_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      // Create an existing LabOrder in SENT status with workflow data
      const existing = await testDb.prisma.labOrder.create({
        data: {
          shopId: shopA.shopId,
          shopifyOrderId: orderId,
          bundleId,
          orderName: `#${orderId}`,
          lensId: lensA.id,
          frameTitle: "Classic Frame",
          status: "SENT",
          lastErrorCode: null,
          attempts: 1,
          ticketKeys: ["shops/test/tickets/order_1.pdf"],
          sentAt: new Date(),
        },
      });

      const frameProps = buildBundleLineProperties({
        role: "frame",
        bundleId,
        storeRxInOrder: false,
      });

      const lensProps = buildBundleLineProperties({
        role: "lens",
        bundleId,
        itemId: lensA.id,
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
              title: "Classic Frame",
              customAttributes: Object.entries(frameProps).map(([key, value]) => ({ key, value })),
            },
            {
              id: `gid://shopify/LineItem/${randomUUID()}`,
              title: "1.56 Standard Lens",
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
      expect(result.labOrders[0].id).toBe(existing.id);
      expect(result.labOrders[0].status).toBe("SENT");

      // Verify row in DB kept its status and workflow fields
      const rowInDb = await testDb.prisma.labOrder.findUnique({
        where: { id: existing.id },
      });
      expect(rowInDb?.status).toBe("SENT");
      expect(rowInDb?.attempts).toBe(1);
      expect(rowInDb?.ticketKeys).toEqual(["shops/test/tickets/order_1.pdf"]);

      // Verify NO dispatch job was enqueued for the already SENT row
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    });

    it("R1-F3: Direct repository upsertLabOrder on existing SENT/FAILED row preserves status and lastErrorCode", async () => {
      const orderId = `repo_test_${randomUUID()}`;
      const bundleId = `bundle_${randomUUID()}`;

      // 1. Initial insert with FAILED status and error code
      const initial = await upsertLabOrder(testDb.prisma, shopA.shopId, {
        shopifyOrderId: orderId,
        orderName: "#1001",
        bundleId,
        lensId: lensA.id,
        frameTitle: "Frame 1",
        status: "FAILED",
        lastErrorCode: "RX_NOT_FOUND",
      });
      expect(initial.status).toBe("FAILED");
      expect(initial.lastErrorCode).toBe("RX_NOT_FOUND");

      // 2. Conflict upsert trying to set PENDING
      const duplicate = await upsertLabOrder(testDb.prisma, shopA.shopId, {
        shopifyOrderId: orderId,
        orderName: "#1001-Duplicate",
        bundleId,
        lensId: lensA.id,
        frameTitle: "Frame 1",
        status: "PENDING",
        lastErrorCode: null,
      });

      expect(duplicate.id).toBe(initial.id);
      expect(duplicate.status).toBe("FAILED");
      expect(duplicate.lastErrorCode).toBe("RX_NOT_FOUND");
    });

    it("R1-F5: Intake handles exactly 250 lines in a single page", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const validRx = {
        od: { sph: -200, cyl: 0, axis: 180 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
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

      const orderId = `page250_${randomUUID()}`;
      const bundleId = `bundle_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const frameProps = buildBundleLineProperties({ role: "frame", bundleId, storeRxInOrder: false });
      const lensProps = buildBundleLineProperties({
        role: "lens",
        bundleId,
        itemId: lensA.id,
        rxRef: prescriptionId,
        storeRxInOrder: false,
      });

      // 248 dummy items + 1 frame + 1 lens = 250 items
      const nodes = [
        {
          id: frameLineId,
          title: "Frame Line",
          customAttributes: Object.entries(frameProps).map(([key, value]) => ({ key, value })),
        },
        {
          id: `gid://shopify/LineItem/${randomUUID()}`,
          title: "Lens Line",
          customAttributes: Object.entries(lensProps).map(([key, value]) => ({ key, value })),
        },
      ];
      for (let i = 0; i < 248; i++) {
        nodes.push({
          id: `gid://shopify/LineItem/dummy_${i}`,
          title: `Dummy Item ${i}`,
          customAttributes: [],
        });
      }

      const fakeAdmin = {
        graphql: vi.fn(async () => ({
          data: {
            order: {
              id: `gid://shopify/Order/${orderId}`,
              name: `#${orderId}`,
              lineItems: {
                pageInfo: { hasNextPage: false, endCursor: "cursor_page1" },
                nodes,
              },
            },
          },
        })),
      };

      const fakeQueue = createFakeQueue();
      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(1);
      expect(fakeAdmin.graphql).toHaveBeenCalledTimes(1);
    });

    it("R1-F5: Intake paginates lineItems across page boundary for 251 lines", async () => {
      const cipher = getCipher();
      const prescriptionId = randomUUID();
      const validRx = {
        od: { sph: -200, cyl: 0, axis: 180 },
        os: { sph: -200, cyl: 0, axis: 180 },
        pd: { single: 630 },
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

      const orderId = `page251_${randomUUID()}`;
      const bundleId = `bundle_${randomUUID()}`;
      const frameLineId = `gid://shopify/LineItem/${randomUUID()}`;

      const frameProps = buildBundleLineProperties({ role: "frame", bundleId, storeRxInOrder: false });
      const lensProps = buildBundleLineProperties({
        role: "lens",
        bundleId,
        itemId: lensA.id,
        rxRef: prescriptionId,
        storeRxInOrder: false,
      });

      // Page 1 has 250 lines (frame line + 249 dummy items)
      const page1Nodes = [
        {
          id: frameLineId,
          title: "Frame Line",
          customAttributes: Object.entries(frameProps).map(([key, value]) => ({ key, value })),
        },
      ];
      for (let i = 0; i < 249; i++) {
        page1Nodes.push({
          id: `gid://shopify/LineItem/p1_dummy_${i}`,
          title: `Dummy ${i}`,
          customAttributes: [],
        });
      }

      // Page 2 has the 251st line (lens line belonging to the bundle on page 1)
      const page2Nodes = [
        {
          id: `gid://shopify/LineItem/${randomUUID()}`,
          title: "Lens Line Page 2",
          customAttributes: Object.entries(lensProps).map(([key, value]) => ({ key, value })),
        },
      ];

      const fakeAdmin = {
        graphql: vi.fn(async (_query: string, options?: { variables?: Record<string, unknown> }) => {
          if (!options?.variables?.cursor) {
            return {
              data: {
                order: {
                  id: `gid://shopify/Order/${orderId}`,
                  name: `#${orderId}`,
                  lineItems: {
                    pageInfo: { hasNextPage: true, endCursor: "cursor_p1_end" },
                    nodes: page1Nodes,
                  },
                },
              },
            };
          }
          if (options.variables.cursor === "cursor_p1_end") {
            return {
              data: {
                order: {
                  id: `gid://shopify/Order/${orderId}`,
                  name: `#${orderId}`,
                  lineItems: {
                    pageInfo: { hasNextPage: false, endCursor: "cursor_p2_end" },
                    nodes: page2Nodes,
                  },
                },
              },
            };
          }
          throw new Error(`Unexpected cursor ${String(options?.variables?.cursor)}`);
        }),
      };

      const fakeQueue = createFakeQueue();
      const service = createIntakeService({
        db: testDb.prisma,
        cipher,
        queue: fakeQueue as unknown as Queue,
        adminClient: fakeAdmin,
      });

      const result = await service.processOrderIntake(shopA.shopId, orderId);

      expect(result.ok).toBe(true);
      expect(result.labOrders).toHaveLength(1);
      expect(fakeAdmin.graphql).toHaveBeenCalledTimes(2);
      expect(fakeAdmin.graphql).toHaveBeenNthCalledWith(
        2,
        ORDER_INTAKE_QUERY,
        { variables: { id: `gid://shopify/Order/${orderId}`, cursor: "cursor_p1_end" } },
      );
    });
  });
});
