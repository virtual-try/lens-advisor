import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getCipher } from "../../shared/container/cipher.server";
import { ConflictError, NotFoundError } from "../../shared/http/errors.server";
import type { Mailer, SendMailOptions } from "../../shared/mail/mailer.server";
import type { Queue } from "../../shared/queue/queue";
import { withTestQueue } from "../../shared/queue/test-support";
import {
  buildRxKey,
  buildTicketKey,
  type ObjectStore,
} from "../../shared/storage/object-store.server";
import { createTestDb, type TestDb } from "../../../test/db";
import { DISPATCH_JOB_NAME } from "../lab-orders/constants";
import {
  DispatchInProgressError,
  createDispatchHandler,
  dispatchJob,
  getAddOns,
  getLabOrder,
  getLabOrderShopId,
  getLens,
  getOptionValues,
  getPrescription,
  loadTicketData,
  markFailed,
  markSent,
  processDispatch,
  resend,
  resetLabOrderStatus,
  transitionToSending,
  DELAY_MARGIN_MS,
  SENDING_STALE_TIMEOUT_MS,
  type DispatchLogger,
} from "./index";

describe("Spec 30 — Lab order dispatch job (ticket → S3 → email)", () => {
  let testDb: TestDb;
  let prisma: PrismaClient;

  beforeAll(async () => {
    testDb = await createTestDb();
    prisma = testDb.prisma;
  });

  afterAll(async () => {
    await testDb.drop();
  });

  // Helpers to seed test data
  async function seedShop(domain: string) {
    return prisma.shop.create({
      data: {
        domain,
        settings: {
          create: {
            labEmails: ["lab1@example.test", "lab2@example.test"],
            ticketFormat: "BOTH",
            storeRxInOrder: false,
            rxUploadEnabled: true,
            manualRxEnabled: true,
          },
        },
      },
    });
  }

  async function seedCatalog(shopId: string) {
    const group = await prisma.lensGroup.create({
      data: {
        shopId,
        name: "Single Vision",
        position: 0,
      },
    });

    const lens = await prisma.lens.create({
      data: {
        shopId,
        groupId: group.id,
        name: "Ultra Thin 1.67",
        priceMinor: 12000,
        currency: "USD",
        sphMin: -1000,
        sphMax: 600,
        cylMin: -400,
        cylMax: 0,
        labCodeTemplate: "PO/58_[material=PLASTIC]_[tint=CLEAR]",
        position: 0,
      },
    });

    const optionGroup = await prisma.optionGroup.create({
      data: {
        shopId,
        kind: "MATERIAL",
        name: "Material",
        position: 0,
      },
    });

    const optionValue1 = await prisma.optionValue.create({
      data: {
        shopId,
        optionGroupId: optionGroup.id,
        label: "Hi-Index 1.67",
        priceDeltaMinor: 0,
        currency: "USD",
        tokenKey: "material",
        tokenValue: "HI167",
        position: 0,
      },
    });

    const optionValue2 = await prisma.optionValue.create({
      data: {
        shopId,
        optionGroupId: optionGroup.id,
        label: "Clear",
        priceDeltaMinor: 0,
        currency: "USD",
        tokenKey: "tint",
        tokenValue: "CLEAR",
        position: 1,
      },
    });

    const addOn = await prisma.addOn.create({
      data: {
        shopId,
        name: "Anti-Reflective Coating",
        priceMinor: 2500,
        currency: "USD",
        position: 0,
      },
    });

    return { group, lens, optionGroup, optionValues: [optionValue1, optionValue2], addOn };
  }

  function createCapturingLogger(): {
    logger: DispatchLogger;
    calls: Array<{ level: string; event: string; meta?: Record<string, unknown> }>;
  } {
    const calls: Array<{ level: string; event: string; meta?: Record<string, unknown> }> = [];
    const logger: DispatchLogger = {
      info: (event, meta) => calls.push({ level: "info", event, meta }),
      warn: (event, meta) => calls.push({ level: "warn", event, meta }),
      error: (event, meta) => calls.push({ level: "error", event, meta }),
    };
    return { logger, calls };
  }

  function createFakeMailer(onSend?: (opts: SendMailOptions) => Promise<{ providerId: string }>) {
    const sentEmails: SendMailOptions[] = [];
    const mailer: Mailer = {
      send: vi.fn(async (opts: SendMailOptions) => {
        sentEmails.push(opts);
        if (onSend) return onSend(opts);
        return { providerId: `provider_msg_${sentEmails.length}` };
      }),
    };
    return { mailer, sentEmails };
  }

  function createFakeObjectStore() {
    const storedObjects = new Map<string, { body: Buffer | Uint8Array | string; contentType?: string }>();
    const objectStore: ObjectStore = {
      bucket: "test-lens-bucket",
      kmsKeyId: "arn:aws:kms:us-east-1:123456789012:key/test-kms-key",
      putObject: vi.fn(async (params) => {
        storedObjects.set(params.key, {
          body: Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body as string),
          contentType: params.contentType,
        });
      }),
      presignUpload: vi.fn(async () => "https://s3.example.test/presigned-upload"),
      presignDownload: vi.fn(async (keyOrParams) => {
        const key = typeof keyOrParams === "string" ? keyOrParams : keyOrParams.key;
        return `https://s3.example.test/download/${key}`;
      }),
      headObject: vi.fn(async () => ({ exists: true })),
      objectExists: vi.fn(async () => true),
      deletePrefix: vi.fn(async () => 0),
    };
    return { objectStore, storedObjects };
  }

  // Distinctive clinical prescription data used across tests for INV-2 verification
  const sensitiveRx = {
    od: { sph: -775, cyl: -125, axis: 137, add: 200 },
    os: { sph: -750, cyl: -100, axis: 45, add: 200 },
    pd: { single: 645 },
    notes: "SENSITIVE_CLINICAL_PATIENT_NOTES_DR_SMITH",
  };

  describe("Examples table verification", () => {
    it("row 1: PENDING, format BOTH, 2 lab emails -> 2 objects in S3, 1 email with 2 tickets attached, SENT (normal)", async () => {
      const shop = await seedShop("shop-row1.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-row1",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-row1`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1001",
          orderName: "#1001",
          bundleId: "bundle-row1",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          optionValueIds: [catalog.optionValues[0].id, catalog.optionValues[1].id],
          addOnIds: [catalog.addOn.id],
          frameTitle: "Ray-Ban Aviator",
          frameSku: "RB3025",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore, storedObjects } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
      });

      expect(result.status).toBe("SENT");
      expect(result.providerId).toBeDefined();

      // Check LabOrder row updated to SENT
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("SENT");
      expect(updated?.providerId).toBe(result.providerId);
      expect(updated?.sentAt).toBeInstanceOf(Date);
      expect(updated?.attempts).toBe(1);
      expect(updated?.ticketKeys).toHaveLength(2);

      // Check S3 has 2 tickets (PDF and CSV)
      expect(storedObjects.size).toBe(2);
      const pdfKey = buildTicketKey(shop.id, order.id, "pdf");
      const csvKey = buildTicketKey(shop.id, order.id, "csv");
      expect(storedObjects.has(pdfKey)).toBe(true);
      expect(storedObjects.has(csvKey)).toBe(true);
      expect(storedObjects.get(pdfKey)?.contentType).toBe("application/pdf");
      expect(storedObjects.get(csvKey)?.contentType).toBe("text/csv");

      // Check exactly 1 email sent to the 2 lab addresses with 2 attachments
      expect(sentEmails).toHaveLength(1);
      const email = sentEmails[0];
      expect(email.to).toEqual(["lab1@example.test", "lab2@example.test"]);
      expect(email.subject).toContain("#1001");
      expect(email.attachments).toHaveLength(2);
      expect(email.attachments?.some((a) => a.filename === `${order.id}.pdf`)).toBe(true);
      expect(email.attachments?.some((a) => a.filename === `${order.id}.csv`)).toBe(true);
      expect(email.idempotencyKey).toBe(`${order.id}:1`);
    });

    it("row 2: UPLOAD Rx with 2 files -> the 2 files attached as well (uploads, presign-and-fetch R1-F12)", async () => {
      const shop = await seedShop("shop-row2.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const fileKey1 = buildRxKey(shop.id, "rx-upload-row2", "scan1", "pdf");
      const fileKey2 = buildRxKey(shop.id, "rx-upload-row2", "scan2", "png");

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-upload-row2",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "UPLOAD",
          cipher: cipher.encrypt({}, `${shop.id}:rx-upload-row2`),
          uploadKeys: [fileKey1, fileKey2],
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1002",
          orderName: "#1002",
          bundleId: "bundle-row2",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Aviator Gold",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      const file1Buffer = Buffer.from("DUMMY_PDF_PRESCRIPTION_CONTENT");
      const file2Buffer = Buffer.from("DUMMY_PNG_IMAGE_CONTENT");

      // R1-F12: Test presign-and-fetch path with injected fetch (non-OK status, success, size cap)
      const fakeFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("scan1.pdf")) {
          return new Response(file1Buffer, { status: 200, headers: { "content-type": "application/pdf" } });
        }
        if (urlStr.includes("scan2.png")) {
          return new Response(file2Buffer, { status: 200, headers: { "content-type": "image/png" } });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
        fetch: fakeFetch,
      });

      expect(result.status).toBe("SENT");
      expect(sentEmails).toHaveLength(1);
      expect(fakeFetch).toHaveBeenCalledTimes(2);

      const email = sentEmails[0];
      // 2 tickets (PDF, CSV) + 2 uploaded prescription files = 4 attachments
      expect(email.attachments).toHaveLength(4);
      expect(email.attachments?.some((a) => a.filename === "scan1.pdf")).toBe(true);
      expect(email.attachments?.some((a) => a.filename === "scan2.png")).toBe(true);
    });

    it("row 2b: presign-and-fetch download failure records STORAGE_FAILED and rethrows (R1-F12)", async () => {
      const shop = await seedShop("shop-row2b.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const fileKey = buildRxKey(shop.id, "rx-upload-row2b", "scan", "pdf");

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-upload-row2b",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "UPLOAD",
          cipher: cipher.encrypt({}, `${shop.id}:rx-upload-row2b`),
          uploadKeys: [fileKey],
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1002b",
          orderName: "#1002b",
          bundleId: "bundle-row2b",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Aviator Gold",
          status: "PENDING",
        },
      });

      const { mailer } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      // Injected fetch returns HTTP 403 Forbidden
      const failingFetch = vi.fn(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          fetch: failingFetch,
        }),
      ).rejects.toThrow();

      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("STORAGE_FAILED");
    });

    it("row 3: job delivered twice concurrently -> 1 email, 1 SENT row (INV-8)", async () => {
      const shop = await seedShop("shop-row3.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-row3",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-row3`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1003",
          orderName: "#1003",
          bundleId: "bundle-row3",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Clubmaster Classic",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      // Run two concurrent dispatch executions
      const results = await Promise.allSettled([
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer, logger }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer, logger }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ status: string }>[];
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // One worker succeeds and dispatches
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.status).toBe("SENT");

      // The concurrent worker receives retryable IN_PROGRESS error (R2-F4)
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(DispatchInProgressError);

      // Exactly one email sent
      expect(sentEmails).toHaveLength(1);

      // Exactly 1 SENT row in DB
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("SENT");
    });

    it("row 4: mailer throws -> FAILED MAIL_FAILED, attempts+1, job retried (retry, R1-F11)", async () => {
      // 1. Assert dispatchJob registered retry options per R1-F11
      expect(dispatchJob.retry).toMatchObject({
        retryLimit: 5,
        retryBackoff: true,
      });

      const shop = await seedShop("shop-row4.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-row4",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-row4`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1004",
          orderName: "#1004",
          bundleId: "bundle-row4",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Metal Classic",
          status: "PENDING",
          attempts: 0,
        },
      });

      // Mailer that fails on first send and succeeds on retry
      let callCount = 0;
      const sentKeys: string[] = [];
      const retryMailer: Mailer = {
        send: vi.fn(async (opts: SendMailOptions) => {
          callCount++;
          sentKeys.push(opts.idempotencyKey!);
          if (callCount === 1) {
            throw new Error("Resend network timeout");
          }
          return { providerId: "provider_retry_success_456" };
        }),
      };
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      // First run: fails
      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer: retryMailer,
          logger,
        }),
      ).rejects.toThrow();

      // Verify row is FAILED, lastErrorCode is MAIL_FAILED, attempts incremented to 1
      const failed = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(failed?.status).toBe("FAILED");
      expect(failed?.lastErrorCode).toBe("MAIL_FAILED");
      expect(failed?.attempts).toBe(1);
      expect(sentKeys[0]).toBe(`${order.id}:1`);

      // Second run: retry succeeds with attempts = 2 and new idempotency key
      const retryResult = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer: retryMailer,
        logger,
      });

      expect(retryResult.status).toBe("SENT");
      expect(retryResult.providerId).toBe("provider_retry_success_456");

      const sentOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(sentOrder?.status).toBe("SENT");
      expect(sentOrder?.attempts).toBe(2);
      expect(sentOrder?.lastErrorCode).toBeNull();
      expect(sentKeys[1]).toBe(`${order.id}:2`);
    });

    it("row 5: no lab emails configured -> FAILED NO_LAB_EMAIL, no retry (permanent)", async () => {
      const shop = await prisma.shop.create({
        data: {
          domain: "shop-row5-no-email.example.test",
          settings: {
            create: {
              labEmails: [], // No lab emails configured
              ticketFormat: "PDF",
              storeRxInOrder: false,
              rxUploadEnabled: true,
              manualRxEnabled: true,
            },
          },
        },
      });
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-row5",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-row5`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1005",
          orderName: "#1005",
          bundleId: "bundle-row5",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Rimless Titanium",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      // Does NOT throw; returns FAILED with NO_LAB_EMAIL (permanent, no retry)
      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
      });

      expect(result.status).toBe("FAILED");
      expect(result.lastErrorCode).toBe("NO_LAB_EMAIL");

      // No email was sent
      expect(sentEmails).toHaveLength(0);

      // Order status updated to FAILED in DB
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("NO_LAB_EMAIL");
    });

    it("row 6: labOrderId of shop B in job for shop A -> returns SKIPPED/order_not_found, nothing written, no email, logs ids only (INV-1, R3-F2)", async () => {
      const shopA = await seedShop("shop-a-row6.example.test");
      const shopB = await seedShop("shop-b-row6.example.test");
      const catalogB = await seedCatalog(shopB.id);
      const cipher = getCipher();

      const rxRowB = await prisma.prescription.create({
        data: {
          id: "rx-shop-b-row6",
          shopId: shopB.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shopB.id}:rx-shop-b-row6`),
        },
      });

      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "1006-b",
          orderName: "#1006-b",
          bundleId: "bundle-row6-b",
          prescriptionId: rxRowB.id,
          lensId: catalogB.lens.id,
          frameTitle: "Shop B Row 6 Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore, storedObjects } = createFakeObjectStore();
      const { logger, calls } = createCapturingLogger();

      // Dispatch job for shop A with shop B's labOrderId
      const result = await processDispatch(shopA.id, orderB.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
      });

      // 1. result SKIPPED / order_not_found
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toBe("order_not_found");

      // 2. No email sent
      expect(sentEmails).toHaveLength(0);

      // 3. No storage writes
      expect(storedObjects.size).toBe(0);

      // 4. Shop B's row is completely unchanged
      const orderBCheck = await prisma.labOrder.findUnique({ where: { id: orderB.id } });
      expect(orderBCheck?.status).toBe("PENDING");
      expect(orderBCheck?.attempts).toBe(0);
      expect(orderBCheck?.lastErrorCode).toBeNull();
      expect(orderBCheck?.providerId).toBeNull();

      // 5. Nothing was written for shop A
      const shopAOrders = await prisma.labOrder.findMany({ where: { shopId: shopA.id } });
      expect(shopAOrders).toHaveLength(0);

      // 6. Log carries ids only
      const skipLog = calls.find((e) => e.event === "lab_dispatch.skipped");
      expect(skipLog).toBeDefined();
      expect(skipLog?.meta).toEqual({
        shopId: shopA.id,
        labOrderId: orderB.id,
        reason: "order_not_found",
      });
      const serializedLog = JSON.stringify(skipLog);
      expect(serializedLog).not.toContain("SPH");
      expect(serializedLog).not.toContain("CYL");
      expect(serializedLog).not.toContain("AXIS");
    });

    it("row 6-prod: production handler with { labOrderId } resolves owning shop via repository and dispatches (R1-F4)", async () => {
      const shop = await seedShop("shop-r1f4-found.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r1f4-found",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r1f4-found`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1006a",
          orderName: "#1006a",
          bundleId: "bundle-r1f4-found",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Handler Production Test",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const handler = createDispatchHandler({
        db: prisma,
        cipher,
        objectStore,
        mailer,
      });

      // Spec 23 enqueues { labOrderId } without shopId (R1-F4)
      await handler({ labOrderId: order.id });

      expect(sentEmails).toHaveLength(1);
      const sentOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(sentOrder?.status).toBe("SENT");
    });

    it("row 6b-prod: production handler with non-existent { labOrderId } logs warning with id only and does not throw (R1-F4)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const handler = createDispatchHandler({ db: prisma });

      // Non-existent labOrderId
      await handler({ labOrderId: "non-existent-lab-order-id" });

      expect(warnSpy).toHaveBeenCalledWith(
        "[lab-dispatch] labOrder non-existent-lab-order-id not found",
      );
      warnSpy.mockRestore();
    });

    it("row 7: Rx ciphertext tampered -> FAILED RX_DECRYPT_FAILED, no email (integrity)", async () => {
      const shop = await seedShop("shop-row7.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const validToken = cipher.encrypt(sensitiveRx, `${shop.id}:rx-row7`);
      // Tamper with the ciphertext
      const tamperedToken = validToken.slice(0, -6) + "TAMPER";

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-row7",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: tamperedToken,
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1007",
          orderName: "#1007",
          bundleId: "bundle-row7",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Tampered Rx Order",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          logger,
        }),
      ).rejects.toThrow("RX_DECRYPT_FAILED");

      // No email was sent
      expect(sentEmails).toHaveLength(0);

      // Order marked FAILED with RX_DECRYPT_FAILED
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("RX_DECRYPT_FAILED");
    });
  });

  describe("Invariants: INV-1, INV-2, INV-8", () => {
    it("INV-1: every repository query is tested with two shops (no cross-shop read or write)", async () => {
      const shopA = await seedShop("inv1-shop-a.example.test");
      const shopB = await seedShop("inv1-shop-b.example.test");
      const catalogA = await seedCatalog(shopA.id);
      const catalogB = await seedCatalog(shopB.id);
      const cipher = getCipher();

      const rxA = await prisma.prescription.create({
        data: {
          id: "rx-shop-a",
          shopId: shopA.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shopA.id}:rx-shop-a`),
        },
      });

      const rxB = await prisma.prescription.create({
        data: {
          id: "rx-shop-b",
          shopId: shopB.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shopB.id}:rx-shop-b`),
        },
      });

      const orderA = await prisma.labOrder.create({
        data: {
          shopId: shopA.id,
          shopifyOrderId: "2001",
          orderName: "#2001-A",
          bundleId: "bundle-2001-a",
          prescriptionId: rxA.id,
          lensId: catalogA.lens.id,
          frameTitle: "Frame A",
          status: "PENDING",
        },
      });

      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "2001",
          orderName: "#2001-B",
          bundleId: "bundle-2001-b",
          prescriptionId: rxB.id,
          lensId: catalogB.lens.id,
          frameTitle: "Frame B",
          status: "PENDING",
        },
      });

      // 1. getLabOrder
      expect(await getLabOrder(shopA.id, orderA.id, prisma)).not.toBeNull();
      expect(await getLabOrder(shopA.id, orderB.id, prisma)).toBeNull();
      expect(await getLabOrder(shopB.id, orderA.id, prisma)).toBeNull();

      // 1b. getLabOrderShopId (R1-F4)
      expect(await getLabOrderShopId(orderA.id, prisma)).toBe(shopA.id);
      expect(await getLabOrderShopId(orderB.id, prisma)).toBe(shopB.id);

      // 2. getPrescription
      expect(await getPrescription(shopA.id, rxA.id, prisma)).not.toBeNull();
      expect(await getPrescription(shopA.id, rxB.id, prisma)).toBeNull();

      // 3. getLens
      expect(await getLens(shopA.id, catalogA.lens.id, prisma)).not.toBeNull();
      expect(await getLens(shopA.id, catalogB.lens.id, prisma)).toBeNull();

      // 4. getOptionValues
      const optA = await getOptionValues(shopA.id, [catalogA.optionValues[0].id], prisma);
      expect(optA).toHaveLength(1);
      const optCross = await getOptionValues(shopA.id, [catalogB.optionValues[0].id], prisma);
      expect(optCross).toHaveLength(0);

      // 5. getAddOns
      const addOnA = await getAddOns(shopA.id, [catalogA.addOn.id], prisma);
      expect(addOnA).toHaveLength(1);
      const addOnCross = await getAddOns(shopA.id, [catalogB.addOn.id], prisma);
      expect(addOnCross).toHaveLength(0);

      // 6. transitionToSending cross-shop isolation
      const transCross = await transitionToSending(shopA.id, orderB.id, prisma);
      expect(transCross.transitioned).toBe(false);
      const orderBCheck = await getLabOrder(shopB.id, orderB.id, prisma);
      expect(orderBCheck?.status).toBe("PENDING");

      // R2-F1: Seed orderBSending in SENDING status to prove shop scoping in markSent & markFailed
      const orderBSending = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "2002",
          orderName: "#2002-B",
          bundleId: "bundle-2002-b",
          prescriptionId: rxB.id,
          lensId: catalogB.lens.id,
          frameTitle: "Frame B Sending",
          status: "SENDING",
        },
      });

      // 7. markSent cross-shop isolation (R2-F1)
      const sentCross = await markSent(shopA.id, orderBSending.id, { providerId: "prov_bad", ticketKeys: [] }, prisma);
      expect(sentCross).toBeNull();

      // 8. markFailed cross-shop isolation (R2-F1)
      const failCross = await markFailed(shopA.id, orderBSending.id, "MAIL_FAILED", prisma);
      expect(failCross).toBeNull();

      // Assert shop B's orderBSending is unchanged: still SENDING, untouched providerId and lastErrorCode
      const orderBSendingCheck = await getLabOrder(shopB.id, orderBSending.id, prisma);
      expect(orderBSendingCheck?.status).toBe("SENDING");
      expect(orderBSendingCheck?.providerId).toBeNull();
      expect(orderBSendingCheck?.lastErrorCode).toBeNull();

      // 9. resetLabOrderStatus cross-shop isolation (R3-F3): seed shop B row as FAILED with lastErrorCode
      const orderBFailed = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "2001-failed",
          orderName: "#2001-B-FAILED",
          bundleId: "bundle-2001-b-failed",
          prescriptionId: rxB.id,
          lensId: catalogB.lens.id,
          frameTitle: "Frame B Failed",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
        },
      });
      const resetCross = await resetLabOrderStatus(shopA.id, orderBFailed.id, "PENDING", prisma);
      expect(resetCross).toBeNull();
      const orderBFailedCheck = await getLabOrder(shopB.id, orderBFailed.id, prisma);
      expect(orderBFailedCheck?.status).toBe("FAILED");
      expect(orderBFailedCheck?.lastErrorCode).toBe("MAIL_FAILED");

      // 10. loadTicketData cross-shop isolation
      await expect(loadTicketData(shopA.id, orderB.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);

      // 11. resend cross-shop isolation (R2-F5)
      const fakeQueue = { enqueue: vi.fn() };
      await expect(resend(shopA.id, orderB.id, { db: prisma, queue: fakeQueue })).rejects.toThrow(NotFoundError);
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
      const orderBCheckAfterResend = await getLabOrder(shopB.id, orderB.id, prisma);
      expect(orderBCheckAfterResend?.status).toBe("PENDING");
    });

    it("INV-2 (R1-F3): logger and console spies across MAIL_FAILED and STORAGE_FAILED rows find zero Rx values", async () => {
      const shop = await seedShop("inv2-rx-memory.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const distinctiveSph = "-8.95";
      const distinctiveCyl = "-2.75";
      const distinctiveAxis = "165";
      const distinctivePd = "63.5";
      const distinctiveNotes = "INV2_HIGH_ASTIGMATISM_PATIENT_SECRET_NOTES_999";

      const rxWithDistinctValues = {
        od: { sph: -895, cyl: -275, axis: 165 },
        os: { sph: -895, cyl: -275, axis: 165 },
        pd: { single: 635 },
        notes: distinctiveNotes,
      };

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-inv2-mem",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(rxWithDistinctValues, `${shop.id}:rx-inv2-mem`),
        },
      });

      const orderMailFail = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "3002",
          orderName: "#3002",
          bundleId: "bundle-inv2-mailfail",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Mail Fail Frame",
          status: "PENDING",
        },
      });

      const orderStorageFail = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "3003",
          orderName: "#3003",
          bundleId: "bundle-inv2-storagefail",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Storage Fail Frame",
          status: "PENDING",
        },
      });

      const failingMailer: Mailer = {
        send: vi.fn().mockRejectedValue(new Error("Resend network outage")),
      };
      const failingObjectStore: ObjectStore = {
        ...createFakeObjectStore().objectStore,
        putObject: vi.fn().mockRejectedValue(new Error("S3 putObject access denied")),
      };

      const { logger, calls } = createCapturingLogger();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const clinicalValues = ["-895", distinctiveSph, "-275", distinctiveCyl, distinctiveAxis, "635", distinctivePd, distinctiveNotes];

      // 1. Test MAIL_FAILED path (Rx decrypted in memory)
      let mailErr: unknown;
      try {
        await processDispatch(shop.id, orderMailFail.id, {
          db: prisma,
          cipher,
          objectStore: createFakeObjectStore().objectStore,
          mailer: failingMailer,
          logger,
        });
      } catch (e) {
        mailErr = e;
      }
      expect(mailErr).toBeDefined();

      // 2. Test STORAGE_FAILED path (Rx decrypted in memory)
      let storageErr: unknown;
      try {
        await processDispatch(shop.id, orderStorageFail.id, {
          db: prisma,
          cipher,
          objectStore: failingObjectStore,
          mailer: createFakeMailer().mailer,
          logger,
        });
      } catch (e) {
        storageErr = e;
      }
      expect(storageErr).toBeDefined();

      // Combine all logged meta, console calls, and error messages
      const allLogs = JSON.stringify(calls);
      const allConsoleWarn = JSON.stringify(consoleWarnSpy.mock.calls);
      const allConsoleError = JSON.stringify(consoleErrorSpy.mock.calls);
      const allErrMessages = `${String((mailErr as Error)?.message)} ${String((mailErr as Error)?.stack)} ${String((storageErr as Error)?.message)} ${String((storageErr as Error)?.stack)}`;

      for (const val of clinicalValues) {
        expect(allLogs, `Logger calls must not leak ${val}`).not.toContain(val);
        expect(allConsoleWarn, `Console.warn calls must not leak ${val}`).not.toContain(val);
        expect(allConsoleError, `Console.error calls must not leak ${val}`).not.toContain(val);
        expect(allErrMessages, `Thrown error messages must not leak ${val}`).not.toContain(val);
      }

      const mailFailOrder = await prisma.labOrder.findUnique({ where: { id: orderMailFail.id } });
      const storageFailOrder = await prisma.labOrder.findUnique({ where: { id: orderStorageFail.id } });
      expect(mailFailOrder?.lastErrorCode).toBe("MAIL_FAILED");
      expect(storageFailOrder?.lastErrorCode).toBe("STORAGE_FAILED");

      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("INV-8: the concurrent-delivery test sends exactly one email and creates one SENT state", async () => {
      const shop = await seedShop("inv8-concurrent.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-inv8",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-inv8`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "4001",
          orderName: "#4001",
          bundleId: "bundle-inv8",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Inv8 Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      // Launch 3 concurrent workers
      await Promise.allSettled([
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
      ]);

      expect(sentEmails).toHaveLength(1);
      const finalState = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(finalState?.status).toBe("SENT");
      expect(finalState?.attempts).toBe(1);
    });
  });

  describe("Self-checks, Checklists, and Code Review Fixes", () => {
    it("Self-check 1: transitionToSending is a single atomic UPDATE; returns false when already SENDING or SENT", async () => {
      const shop = await seedShop("sc1-shop.example.test");
      const catalog = await seedCatalog(shop.id);

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "5001",
          orderName: "#5001",
          bundleId: "bundle-sc1",
          lensId: catalog.lens.id,
          frameTitle: "Frame SC1",
          status: "PENDING",
          attempts: 0,
        },
      });

      // 1. First transition from PENDING succeeds
      const first = await transitionToSending(shop.id, order.id, prisma);
      expect(first.transitioned).toBe(true);
      expect(first.attempts).toBe(1);

      // Verify row is SENDING in DB
      const sending = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(sending?.status).toBe("SENDING");
      expect(sending?.attempts).toBe(1);

      // 2. Second worker trying to transition actively-leased SENDING order loses
      const second = await transitionToSending(shop.id, order.id, prisma);
      expect(second.transitioned).toBe(false);
      expect(second.attempts).toBe(0);

      // 3. Mark as SENT: transition from SENT loses
      await markSent(shop.id, order.id, { providerId: "prov_sc1", ticketKeys: [] }, prisma);
      const third = await transitionToSending(shop.id, order.id, prisma);
      expect(third.transitioned).toBe(false);
      expect(third.attempts).toBe(0);
    });

    it("Self-check 3 (R1-F10): archived lenses, option values, and add-ons still render on old orders", async () => {
      const shop = await seedShop("sc3-archived-all.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      // Soft-delete (archive) the lens, option value, and add-on
      await prisma.lens.update({
        where: { id: catalog.lens.id },
        data: { archivedAt: new Date() },
      });
      await prisma.optionValue.update({
        where: { id: catalog.optionValues[0].id },
        data: { archivedAt: new Date() },
      });
      await prisma.addOn.update({
        where: { id: catalog.addOn.id },
        data: { archivedAt: new Date() },
      });

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-sc3",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-sc3`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "5003",
          orderName: "#5003",
          bundleId: "bundle-sc3",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          optionValueIds: [catalog.optionValues[0].id],
          addOnIds: [catalog.addOn.id],
          frameTitle: "Archived Items Order",
          status: "PENDING",
        },
      });

      // loadTicketData succeeds and loads archived lens name, option label, and add-on name
      const ticketData = await loadTicketData(shop.id, order.id, { db: prisma, cipher });
      expect(ticketData.lensName).toBe("Ultra Thin 1.67");
      expect(ticketData.labCodeTemplate).toBe("PO/58_[material=PLASTIC]_[tint=CLEAR]");
      expect(ticketData.optionLabels).toContain("Hi-Index 1.67");
      expect(ticketData.addOnNames).toContain("Anti-Reflective Coating");

      // Full dispatch renders and sends without error
      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
      });

      expect(result.status).toBe("SENT");
      expect(sentEmails).toHaveLength(1);
    });

    it("R2-F3: once Mailer.send succeeds, markSent failure leaves row in SENDING, and retry reuses same attempts and idempotency key", async () => {
      const shop = await seedShop("shop-r2f3-mark-sent.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f3-marksent",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r2f3-marksent`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1007-marksent",
          orderName: "#1007-marksent",
          bundleId: "bundle-r2f3-marksent",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "MarkSent Crash Test",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const fakeQueue = { enqueue: vi.fn() };

      const repoModule = await import("./lab-dispatch.repository.server");
      const markSentSpy = vi.spyOn(repoModule, "markSent").mockRejectedValueOnce(new Error("Database crash in markSent"));

      // 1. First run: mailer sends, but markSent throws
      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          queue: fakeQueue,
        }),
      ).rejects.toThrow("Database crash in markSent");

      markSentSpy.mockRestore();

      // R3-F1: Verify delayed dispatch job was enqueued with lease expiry + margin
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: order.id },
        expect.objectContaining({
          singletonKey: expect.stringContaining(`${order.id}:delayed:`),
          startAfter: expect.any(Date),
        }),
      );

      // Verify row is NOT marked FAILED; it is left in SENDING with attempts = 1
      const intermediate = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(intermediate?.status).toBe("SENDING");
      expect(intermediate?.attempts).toBe(1);
      expect(intermediate?.lastErrorCode).toBeNull();
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].idempotencyKey).toBe(`${order.id}:1`);

      // 2. Simulate lease expiration so stale SENDING row can be reclaimed
      await prisma.labOrder.update({
        where: { id: order.id },
        data: {
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      });

      // 3. Retry run: reclaims stale SENDING row, reuses attempts = 1 and same idempotency key
      const retryResult = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
      });

      expect(retryResult.status).toBe("SENT");
      expect(sentEmails).toHaveLength(2);
      expect(sentEmails[1].idempotencyKey).toBe(`${order.id}:1`); // Provider deduplicates because idempotency key is identical

      const finalOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(finalOrder?.status).toBe("SENT");
      expect(finalOrder?.attempts).toBe(1);
      expect(finalOrder?.providerId).toBeDefined();
    });

    it("R3-F1: delayed dispatch recovery after markSent failure: worker meeting fresh SENDING lease completes without burning retries, and delayed job reclaims after lease expiry with same idempotency key", async () => {
      const shop = await seedShop("shop-r3f1-recovery.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r3f1-recovery",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r3f1-recovery`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1008-r3f1",
          orderName: "#1008-r3f1",
          bundleId: "bundle-r3f1-recovery",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "R3F1 Recovery Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const fakeQueue = { enqueue: vi.fn().mockResolvedValue("job-delayed-1") };

      // Injected clock starting at T0
      let currentTime = new Date("2026-11-08T12:00:00.000Z");
      const clock = () => currentTime;

      const repoModule = await import("./lab-dispatch.repository.server");
      const markSentSpy = vi.spyOn(repoModule, "markSent").mockRejectedValueOnce(new Error("Transient connection reset in markSent"));

      // 1. Initial worker execution at T0: mailer sends, but markSent throws
      const handler = createDispatchHandler({
        db: prisma,
        cipher,
        objectStore,
        mailer,
        queue: fakeQueue,
        now: clock,
      });

      // markSent failure rethrows from processDispatch and handler rethrows for initial failure
      await expect(handler({ labOrderId: order.id })).rejects.toThrow("Transient connection reset in markSent");
      markSentSpy.mockRestore();

      // Row is left in SENDING with attempts = 1, lastErrorCode = null
      const rowAfterCrash = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(rowAfterCrash?.status).toBe("SENDING");
      expect(rowAfterCrash?.attempts).toBe(1);
      expect(rowAfterCrash?.lastErrorCode).toBeNull();
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].idempotencyKey).toBe(`${order.id}:1`);

      // Verify delayed dispatch job was enqueued with startAfter = lease expiry + margin and singletonKey
      const expectedLeaseExpiry = new Date(currentTime.getTime() + SENDING_STALE_TIMEOUT_MS);
      const expectedStartAfter = new Date(expectedLeaseExpiry.getTime() + DELAY_MARGIN_MS);
      const expectedSingletonKey = `${order.id}:delayed:${currentTime.getTime()}`;

      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: order.id },
        {
          startAfter: expectedStartAfter,
          singletonKey: expectedSingletonKey,
        },
      );

      // 2. pg-boss retries with backoff (e.g. 2s, 4s, 8s, etc.).
      // Advance clock by 2 seconds: retry lands inside the 15-minute lease!
      currentTime = new Date(currentTime.getTime() + 2_000);

      // Worker meets a fresh SENDING lease: MUST complete cleanly without burning retries!
      await expect(handler({ labOrderId: order.id })).resolves.toBeUndefined();

      // Row is still SENDING, attempts is still 1, no second email sent during retry
      const rowDuringRetry = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(rowDuringRetry?.status).toBe("SENDING");
      expect(rowDuringRetry?.attempts).toBe(1);
      expect(sentEmails).toHaveLength(1);

      // 3. Clock advances to startAfter (lease expiry + margin has passed)
      currentTime = new Date(expectedStartAfter.getTime() + 1_000);

      // Delayed job executes after lease expiration: reclaims stale row and dispatches
      await handler({ labOrderId: order.id });

      // Row is now SENT, attempts preserved at 1, sentEmails has 2 sends with identical idempotencyKey
      const finalRow = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(finalRow?.status).toBe("SENT");
      expect(finalRow?.attempts).toBe(1);
      expect(finalRow?.providerId).toBeDefined();

      expect(sentEmails).toHaveLength(2);
      expect(sentEmails[0].idempotencyKey).toBe(`${order.id}:1`);
      expect(sentEmails[1].idempotencyKey).toBe(`${order.id}:1`);
    });

    it("R3-F4: if markSent returns null (lost lease / slow worker), logs lost lease and returns SKIPPED, never SENT", async () => {
      const shop = await seedShop("shop-r3f4-marksent-null.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r3f4-ms-null",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r3f4-ms-null`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1009-r3f4",
          orderName: "#1009-r3f4",
          bundleId: "bundle-r3f4-ms-null",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "MarkSent Null Frame",
          status: "PENDING",
        },
      });

      const { mailer } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger, calls } = createCapturingLogger();

      // Spy on markSent to simulate a slow worker whose lease was reclaimed (count = 0, returns null)
      const repoModule = await import("./lab-dispatch.repository.server");
      const markSentSpy = vi.spyOn(repoModule, "markSent").mockResolvedValueOnce(null);

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
      });

      markSentSpy.mockRestore();

      // Must return SKIPPED with reason lost_lease, NEVER SENT
      expect(result.status).toBe("SKIPPED");
      expect(result.status).not.toBe("SENT");
      expect(result.reason).toBe("lost_lease");

      // Verify logger logged lost_lease
      const lostLog = calls.find((e) => e.event === "lab_dispatch.lost_lease");
      expect(lostLog).toBeDefined();
      expect(lostLog?.meta).toMatchObject({
        shopId: shop.id,
        labOrderId: order.id,
        reason: "mark_sent_lost_lease",
      });
    });

    it("R3-F4: if markFailed returns null (lost lease / slow worker), logs lost lease and returns SKIPPED", async () => {
      const shop = await seedShop("shop-r3f4-markfailed-null.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r3f4-mf-null",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r3f4-mf-null`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1010-r3f4",
          orderName: "#1010-r3f4",
          bundleId: "bundle-r3f4-mf-null",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "MarkFailed Null Frame",
          status: "PENDING",
        },
      });

      const { mailer } = createFakeMailer();
      const failingStore = {
        bucket: "test-bucket",
        kmsKeyId: "test-kms",
        putObject: vi.fn().mockRejectedValue(new Error("S3 503 Service Unavailable")),
        presignUpload: vi.fn(),
        presignDownload: vi.fn(),
        headObject: vi.fn(),
        objectExists: vi.fn(),
        deletePrefix: vi.fn(),
      };
      const { logger, calls } = createCapturingLogger();

      // Spy on markFailed to simulate lost lease (count = 0, returns null)
      const repoModule = await import("./lab-dispatch.repository.server");
      const markFailedSpy = vi.spyOn(repoModule, "markFailed").mockResolvedValueOnce(null);

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore: failingStore,
        mailer,
        logger,
      });

      markFailedSpy.mockRestore();

      // Must return SKIPPED with reason lost_lease
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toBe("lost_lease");

      // Verify logger logged lost_lease
      const lostLog = calls.find((e) => e.event === "lab_dispatch.lost_lease");
      expect(lostLog).toBeDefined();
      expect(lostLog?.meta).toMatchObject({
        shopId: shop.id,
        labOrderId: order.id,
        reason: "mark_failed_lost_lease",
      });
    });

    it("R1-F2: stale SENDING row (updatedAt older than 15 min) is reclaimed and reuses same attempts value", async () => {
      const shop = await seedShop("shop-r1f2-stale.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r1f2-stale",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r1f2-stale`),
        },
      });

      // Order left in SENDING with attempts = 1 and updatedAt 20 minutes ago
      const staleTime = new Date(Date.now() - 20 * 60 * 1000);
      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1008-stale",
          orderName: "#1008-stale",
          bundleId: "bundle-r1f2-stale",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Stale Sending Order",
          status: "SENDING",
          attempts: 1,
          updatedAt: staleTime,
        },
      });

      // Direct transitionToSending check
      const { transitioned, attempts } = await transitionToSending(shop.id, order.id, prisma);
      expect(transitioned).toBe(true);
      // Reclaims without incrementing attempts (attempts stays 1 so mailer idempotency key is unchanged)
      expect(attempts).toBe(1);

      // Reset updatedAt back to staleTime to test processDispatch end-to-end reclaim
      await prisma.labOrder.update({
        where: { id: order.id },
        data: { updatedAt: staleTime },
      });

      // Now dispatch it through processDispatch
      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
      });

      expect(result.status).toBe("SENT");
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].idempotencyKey).toBe(`${order.id}:1`);

      const finished = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(finished?.status).toBe("SENT");
      expect(finished?.attempts).toBe(1);
    });

    it("R1-F5: resend refuses PENDING or SENDING with ConflictError and only resets FAILED or SENT", async () => {
      const shop = await seedShop("shop-r1f5.example.test");
      const catalog = await seedCatalog(shop.id);

      const pendingOrder = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "501-p",
          orderName: "#501-p",
          bundleId: "bundle-pending",
          lensId: catalog.lens.id,
          frameTitle: "Pending Order",
          status: "PENDING",
        },
      });

      const sendingOrder = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "502-s",
          orderName: "#502-s",
          bundleId: "bundle-sending",
          lensId: catalog.lens.id,
          frameTitle: "Sending Order",
          status: "SENDING",
        },
      });

      const fakeQueue: Pick<Queue, "enqueue"> = {
        enqueue: vi.fn(async () => "job_r1f5"),
      };

      // Resend on PENDING must throw ConflictError
      await expect(
        resend(shop.id, pendingOrder.id, { db: prisma, queue: fakeQueue }),
      ).rejects.toThrow(ConflictError);

      // Resend on SENDING must throw ConflictError
      await expect(
        resend(shop.id, sendingOrder.id, { db: prisma, queue: fakeQueue }),
      ).rejects.toThrow(ConflictError);

      // Statuses must remain unchanged
      expect((await prisma.labOrder.findUnique({ where: { id: pendingOrder.id } }))?.status).toBe("PENDING");
      expect((await prisma.labOrder.findUnique({ where: { id: sendingOrder.id } }))?.status).toBe("SENDING");
    });

    it("R1-F5: late worker markSent / markFailed is conditional on status = SENDING and cannot overwrite", async () => {
      const shop = await seedShop("shop-r1f5-late.example.test");
      const catalog = await seedCatalog(shop.id);

      // Order is already SENT
      const sentOrder = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "503-sent",
          orderName: "#503-sent",
          bundleId: "bundle-late",
          lensId: catalog.lens.id,
          frameTitle: "Sent Order",
          status: "SENT",
          providerId: "original_provider_123",
        },
      });

      // A late worker tries to mark it SENT again or FAILED
      const markSentResult = await markSent(
        shop.id,
        sentOrder.id,
        { providerId: "late_provider_999", ticketKeys: [] },
        prisma,
      );
      expect(markSentResult).toBeNull();

      const markFailedResult = await markFailed(
        shop.id,
        sentOrder.id,
        "MAIL_FAILED",
        prisma,
      );
      expect(markFailedResult).toBeNull();

      // Original state is completely intact
      const intact = await prisma.labOrder.findUnique({ where: { id: sentOrder.id } });
      expect(intact?.status).toBe("SENT");
      expect(intact?.providerId).toBe("original_provider_123");
      expect(intact?.lastErrorCode).toBeNull();
    });

    it("R1-F7: error codes are accurately labeled (TICKET_RENDER_FAILED, LOAD_FAILED, RX_DECRYPT_FAILED)", async () => {
      const shop = await seedShop("shop-r1f7.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r1f7",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r1f7`),
        },
      });

      // 1. Renderer error -> TICKET_RENDER_FAILED
      const orderRenderFail = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "701-render",
          orderName: "#701-render",
          bundleId: "bundle-render-fail",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Render Fail Frame",
          status: "PENDING",
        },
      });

      const pdfRenderer = await import("../lab-orders/ticket/pdf-renderer");
      const pdfSpy = vi.spyOn(pdfRenderer, "renderPdf").mockRejectedValueOnce(new Error("Font rendering crash"));

      await expect(
        processDispatch(shop.id, orderRenderFail.id, {
          db: prisma,
          cipher,
          objectStore: createFakeObjectStore().objectStore,
          mailer: createFakeMailer().mailer,
        }),
      ).rejects.toThrow("Font rendering crash");

      pdfSpy.mockRestore();

      const renderFailedOrder = await prisma.labOrder.findUnique({ where: { id: orderRenderFail.id } });
      expect(renderFailedOrder?.status).toBe("FAILED");
      expect(renderFailedOrder?.lastErrorCode).toBe("TICKET_RENDER_FAILED");

      // 2. Missing row in loadTicketData -> LOAD_FAILED
      const rxRowLoadFail = await prisma.prescription.create({
        data: {
          id: "rx-r1f7-load",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r1f7-load`),
        },
      });

      const orderLoadFail = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "702-load",
          orderName: "#702-load",
          bundleId: "bundle-load-fail",
          prescriptionId: rxRowLoadFail.id,
          lensId: catalog.lens.id,
          frameTitle: "Load Fail Frame",
          status: "PENDING",
        },
      });

      const repo = await import("./lab-dispatch.repository.server");
      const getPrescriptionSpy = vi.spyOn(repo, "getPrescription").mockResolvedValueOnce(null);

      await expect(
        processDispatch(shop.id, orderLoadFail.id, {
          db: prisma,
          cipher,
          objectStore: createFakeObjectStore().objectStore,
          mailer: createFakeMailer().mailer,
        }),
      ).rejects.toThrow(NotFoundError);

      getPrescriptionSpy.mockRestore();

      const loadFailedOrder = await prisma.labOrder.findUnique({ where: { id: orderLoadFail.id } });
      expect(loadFailedOrder?.status).toBe("FAILED");
      expect(loadFailedOrder?.lastErrorCode).toBe("LOAD_FAILED");
    });

    it("R1-F8: decrypted Rx payload is validated against schema; invalid payload fails with RX_DECRYPT_FAILED", async () => {
      const shop = await seedShop("shop-r1f8.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      // Ciphertext decrypts cleanly with AAD, but payload violates prescriptionSchema (corrupt shape)
      const malformedPayload = {
        od: { sph: "NOT_A_VALID_NUMBER" },
        os: {},
      };

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r1f8-corrupt",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(malformedPayload, `${shop.id}:rx-r1f8-corrupt`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "801-rx-val",
          orderName: "#801-rx-val",
          bundleId: "bundle-corrupt-rx",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Corrupt Rx Order",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore: createFakeObjectStore().objectStore,
          mailer,
        }),
      ).rejects.toThrow("RX_DECRYPT_FAILED");

      // No email sent
      expect(sentEmails).toHaveLength(0);

      // Order marked FAILED with RX_DECRYPT_FAILED
      const failedOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(failedOrder?.status).toBe("FAILED");
      expect(failedOrder?.lastErrorCode).toBe("RX_DECRYPT_FAILED");
    });

    it("ticketFormat variations: PDF only, CSV only, BOTH", async () => {
      const shop = await seedShop("format-test-shop.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-format-test",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-format-test`),
        },
      });

      // 1. PDF only
      await prisma.shopSettings.update({
        where: { shopId: shop.id },
        data: { ticketFormat: "PDF" },
      });

      const orderPdf = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "6001",
          orderName: "#6001",
          bundleId: "bundle-pdf",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "PDF Only Frame",
          status: "PENDING",
        },
      });

      const { mailer: m1, sentEmails: e1 } = createFakeMailer();
      const { objectStore: s1, storedObjects: o1 } = createFakeObjectStore();

      await processDispatch(shop.id, orderPdf.id, { db: prisma, cipher, objectStore: s1, mailer: m1 });
      expect(o1.size).toBe(1);
      expect([...o1.keys()][0]).toContain(".pdf");
      expect(e1[0].attachments).toHaveLength(1);
      expect(e1[0].attachments?.[0].filename).toBe(`${orderPdf.id}.pdf`);

      // 2. CSV only
      await prisma.shopSettings.update({
        where: { shopId: shop.id },
        data: { ticketFormat: "CSV" },
      });

      const orderCsv = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "6002",
          orderName: "#6002",
          bundleId: "bundle-csv",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "CSV Only Frame",
          status: "PENDING",
        },
      });

      const { mailer: m2, sentEmails: e2 } = createFakeMailer();
      const { objectStore: s2, storedObjects: o2 } = createFakeObjectStore();

      await processDispatch(shop.id, orderCsv.id, { db: prisma, cipher, objectStore: s2, mailer: m2 });
      expect(o2.size).toBe(1);
      expect([...o2.keys()][0]).toContain(".csv");
      expect(e2[0].attachments).toHaveLength(1);
      expect(e2[0].attachments?.[0].filename).toBe(`${orderCsv.id}.csv`);
    });

    it("resend service: resets order to PENDING and enqueues dispatch job (R1-F1 typed fakeQueue)", async () => {
      const shop = await seedShop("resend-test-shop.example.test");
      const catalog = await seedCatalog(shop.id);

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "7001",
          orderName: "#7001",
          bundleId: "bundle-resend",
          lensId: catalog.lens.id,
          frameTitle: "Resend Frame",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
          attempts: 1,
        },
      });

      // R1-F1: Type fake queue as Pick<Queue, "enqueue">; no eslint-disable and no 'as any'
      const fakeQueue: Pick<Queue, "enqueue"> = {
        enqueue: vi.fn(async () => "job_123"),
      };

      const res = await resend(shop.id, order.id, {
        db: prisma,
        queue: fakeQueue,
      });

      expect(res.enqueued).toBe(true);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: order.id },
        { singletonKey: order.id },
      );

      // Verify status reset to PENDING and lastErrorCode cleared
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("PENDING");
      expect(updated?.lastErrorCode).toBeNull();
    });

    it("S3 storage failure: records STORAGE_FAILED and rethrows", async () => {
      const shop = await seedShop("storage-fail-shop.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-storage-fail",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-storage-fail`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "8001",
          orderName: "#8001",
          bundleId: "bundle-storage-fail",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Storage Fail Frame",
          status: "PENDING",
        },
      });

      const failingStore = {
        bucket: "test-bucket",
        kmsKeyId: "test-kms",
        putObject: vi.fn().mockRejectedValue(new Error("S3 PutObject 503 Service Unavailable")),
        presignUpload: vi.fn(),
        presignDownload: vi.fn(),
        headObject: vi.fn(),
        objectExists: vi.fn(),
        deletePrefix: vi.fn(),
      };

      const { mailer } = createFakeMailer();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore: failingStore,
          mailer,
        }),
      ).rejects.toThrow();

      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("STORAGE_FAILED");
    });

    it("R2-F2: missing lens, option value, add-on, or prescription never produces blank ticket; throws NotFoundError, records FAILED LOAD_FAILED, sends no email", async () => {
      const shop = await seedShop("shop-r2f2-missing.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f2-valid",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r2f2-valid`),
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      // Case 1: labOrder.lensId is null
      const orderNullLens = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "201",
          orderName: "#201",
          bundleId: "bundle-null-lens",
          prescriptionId: rxRow.id,
          lensId: null,
          frameTitle: "Null Lens Frame",
          status: "PENDING",
        },
      });

      await expect(loadTicketData(shop.id, orderNullLens.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      await expect(processDispatch(shop.id, orderNullLens.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      const orderNullLensDb = await prisma.labOrder.findUnique({ where: { id: orderNullLens.id } });
      expect(orderNullLensDb?.status).toBe("FAILED");
      expect(orderNullLensDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Case 2: labOrder.lensId is set, but getLens resolves to null (e.g. cross-shop or deleted)
      const orderMissingLens = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "202",
          orderName: "#202",
          bundleId: "bundle-missing-lens",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Missing Lens Frame",
          status: "PENDING",
        },
      });

      const repoModule = await import("./lab-dispatch.repository.server");
      const getLensSpy = vi.spyOn(repoModule, "getLens").mockResolvedValueOnce(null);
      await expect(loadTicketData(shop.id, orderMissingLens.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      getLensSpy.mockRestore();

      const getLensSpy2 = vi.spyOn(repoModule, "getLens").mockResolvedValueOnce(null);
      await expect(processDispatch(shop.id, orderMissingLens.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      getLensSpy2.mockRestore();

      const orderMissingLensDb = await prisma.labOrder.findUnique({ where: { id: orderMissingLens.id } });
      expect(orderMissingLensDb?.status).toBe("FAILED");
      expect(orderMissingLensDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Case 3: labOrder.optionValueIds contains a non-existent option value id
      const orderMissingOption = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "203",
          orderName: "#203",
          bundleId: "bundle-missing-opt",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          optionValueIds: ["missing-option-val-id"],
          frameTitle: "Missing Option Frame",
          status: "PENDING",
        },
      });

      await expect(loadTicketData(shop.id, orderMissingOption.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      await expect(processDispatch(shop.id, orderMissingOption.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      const orderMissingOptionDb = await prisma.labOrder.findUnique({ where: { id: orderMissingOption.id } });
      expect(orderMissingOptionDb?.status).toBe("FAILED");
      expect(orderMissingOptionDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Case 4: labOrder.addOnIds contains a non-existent add-on id
      const orderMissingAddon = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "204",
          orderName: "#204",
          bundleId: "bundle-missing-addon",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          addOnIds: ["missing-addon-id"],
          frameTitle: "Missing Addon Frame",
          status: "PENDING",
        },
      });

      await expect(loadTicketData(shop.id, orderMissingAddon.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      await expect(processDispatch(shop.id, orderMissingAddon.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      const orderMissingAddonDb = await prisma.labOrder.findUnique({ where: { id: orderMissingAddon.id } });
      expect(orderMissingAddonDb?.status).toBe("FAILED");
      expect(orderMissingAddonDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Case 5: labOrder.prescriptionId is null
      const orderNullRx = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "205",
          orderName: "#205",
          bundleId: "bundle-null-rx",
          prescriptionId: null,
          lensId: catalog.lens.id,
          frameTitle: "Null Rx Frame",
          status: "PENDING",
        },
      });

      await expect(loadTicketData(shop.id, orderNullRx.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      await expect(processDispatch(shop.id, orderNullRx.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      const orderNullRxDb = await prisma.labOrder.findUnique({ where: { id: orderNullRx.id } });
      expect(orderNullRxDb?.status).toBe("FAILED");
      expect(orderNullRxDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Case 6: labOrder.prescriptionId is set, but getPrescription resolves to null (e.g. cross-shop or deleted)
      const orderMissingRx = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "206",
          orderName: "#206",
          bundleId: "bundle-missing-rx",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Missing Rx Frame",
          status: "PENDING",
        },
      });

      const getRxSpy = vi.spyOn(repoModule, "getPrescription").mockResolvedValueOnce(null);
      await expect(loadTicketData(shop.id, orderMissingRx.id, { db: prisma, cipher })).rejects.toThrow(NotFoundError);
      getRxSpy.mockRestore();

      const getRxSpy2 = vi.spyOn(repoModule, "getPrescription").mockResolvedValueOnce(null);
      await expect(processDispatch(shop.id, orderMissingRx.id, { db: prisma, cipher, objectStore, mailer })).rejects.toThrow(NotFoundError);
      getRxSpy2.mockRestore();

      const orderMissingRxDb = await prisma.labOrder.findUnique({ where: { id: orderMissingRx.id } });
      expect(orderMissingRxDb?.status).toBe("FAILED");
      expect(orderMissingRxDb?.lastErrorCode).toBe("LOAD_FAILED");

      // Across all missing cases, no email was ever sent
      expect(sentEmails).toHaveLength(0);
    });

    it("R2-F4: fresh SENDING row throws retryable DispatchInProgressError; returns SKIPPED only for SENT or not found", async () => {
      const shop = await seedShop("shop-r2f4-fresh.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f4-fresh",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r2f4-fresh`),
        },
      });

      // 1. Fresh SENDING order (updatedAt is current)
      const orderSending = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "301",
          orderName: "#301",
          bundleId: "bundle-fresh-sending",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Fresh Sending Frame",
          status: "SENDING",
          updatedAt: new Date(),
        },
      });

      // Calling processDispatch must throw DispatchInProgressError (IN_PROGRESS)
      await expect(
        processDispatch(shop.id, orderSending.id, { db: prisma, cipher }),
      ).rejects.toThrow(DispatchInProgressError);

      // R3-F1: Calling worker handler when meeting a fresh SENDING lease enqueues delayed job
      // and completes without burning retries (does not throw DispatchInProgressError)
      const fakeQueue = { enqueue: vi.fn() };
      const handler = createDispatchHandler({ db: prisma, cipher, queue: fakeQueue });
      await expect(handler({ labOrderId: orderSending.id })).resolves.toBeUndefined();
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: orderSending.id },
        expect.objectContaining({
          singletonKey: expect.stringContaining(`${orderSending.id}:delayed:`),
          startAfter: expect.any(Date),
        }),
      );

      // 2. Already SENT order returns SKIPPED
      const orderSent = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "302",
          orderName: "#302",
          bundleId: "bundle-already-sent",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Already Sent Frame",
          status: "SENT",
        },
      });

      const sentResult = await processDispatch(shop.id, orderSent.id, { db: prisma, cipher });
      expect(sentResult).toEqual({ status: "SKIPPED", reason: "already_sent" });

      // 3. Non-existent order returns SKIPPED
      const notFoundResult = await processDispatch(shop.id, "non-existent-order-id-404", { db: prisma, cipher });
      expect(notFoundResult).toEqual({ status: "SKIPPED", reason: "order_not_found" });
    });

    it("R2-F6: resend checks resetLabOrderStatus and restores previous status if enqueue fails", async () => {
      const shop = await seedShop("shop-r2f6-resend.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f6",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r2f6`),
        },
      });

      const orderFailed = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "401",
          orderName: "#401",
          bundleId: "bundle-r2f6-fail",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "R2F6 Frame",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
        },
      });

      // 1. If resetLabOrderStatus returns null (simulated race condition) -> throws ConflictError
      const repoModule = await import("./lab-dispatch.repository.server");
      const resetSpy = vi.spyOn(repoModule, "resetLabOrderStatus").mockResolvedValueOnce(null);
      const fakeQueue = { enqueue: vi.fn() };

      await expect(
        resend(shop.id, orderFailed.id, { db: prisma, queue: fakeQueue }),
      ).rejects.toThrow(ConflictError);

      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
      resetSpy.mockRestore();

      // 2. If enqueue fails after reset -> restores previous status & lastErrorCode
      const failingQueue = {
        enqueue: vi.fn().mockRejectedValueOnce(new Error("Queue broker disconnected")),
      };

      await expect(
        resend(shop.id, orderFailed.id, { db: prisma, queue: failingQueue }),
      ).rejects.toThrow("Queue broker disconnected");

      // Verify row was NOT left stuck in PENDING with no job; restored to FAILED with MAIL_FAILED
      const reverted = await prisma.labOrder.findUnique({ where: { id: orderFailed.id } });
      expect(reverted?.status).toBe("FAILED");
      expect(reverted?.lastErrorCode).toBe("MAIL_FAILED");

      // Subsequent resend with working queue succeeds
      const workingQueue = { enqueue: vi.fn().mockResolvedValueOnce("job-ok") };
      const resendSuccess = await resend(shop.id, orderFailed.id, { db: prisma, queue: workingQueue });
      expect(resendSuccess.enqueued).toBe(true);

      const finalPending = await prisma.labOrder.findUnique({ where: { id: orderFailed.id } });
      expect(finalPending?.status).toBe("PENDING");
      expect(finalPending?.lastErrorCode).toBeNull();
    });

    it("R2-F7: upload download enforces streaming size cap and timeout with injected fetch", async () => {
      const shop = await seedShop("shop-r2f7-stream.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const fileKey = buildRxKey(shop.id, "rx-r2f7", "oversized", "pdf");
      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f7",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "UPLOAD",
          cipher: cipher.encrypt({}, `${shop.id}:rx-r2f7`),
          uploadKeys: [fileKey],
        },
      });

      const orderStream = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "501",
          orderName: "#501",
          bundleId: "bundle-r2f7-stream",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Stream Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      // 1. Streaming body exceeds 10MB running cap without Content-Length
      const chunk6MB = new Uint8Array(6 * 1024 * 1024);
      let chunkCount = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkCount < 2) {
            chunkCount++;
            controller.enqueue(chunk6MB);
          } else {
            controller.close();
          }
        },
      });

      const streamingFetch = vi.fn(async () => new Response(stream)) as unknown as typeof fetch;

      await expect(
        processDispatch(shop.id, orderStream.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          fetch: streamingFetch,
        }),
      ).rejects.toThrow("exceeds maximum allowed size");

      const streamDb = await prisma.labOrder.findUnique({ where: { id: orderStream.id } });
      expect(streamDb?.status).toBe("FAILED");
      expect(streamDb?.lastErrorCode).toBe("STORAGE_FAILED");
      expect(sentEmails).toHaveLength(0);

      // 2. Content-Length header exceeds 10MB cap
      const orderHeader = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "502",
          orderName: "#502",
          bundleId: "bundle-r2f7-header",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Header Frame",
          status: "PENDING",
        },
      });

      const headerFetch = vi.fn(async () =>
        new Response("large body", {
          headers: { "content-length": "15000000" },
        }),
      ) as unknown as typeof fetch;

      await expect(
        processDispatch(shop.id, orderHeader.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          fetch: headerFetch,
        }),
      ).rejects.toThrow("exceeds maximum allowed size");

      const headerDb = await prisma.labOrder.findUnique({ where: { id: orderHeader.id } });
      expect(headerDb?.status).toBe("FAILED");
      expect(headerDb?.lastErrorCode).toBe("STORAGE_FAILED");
      expect(sentEmails).toHaveLength(0);

      // 3. Injected fetch abort/timeout
      const orderTimeout = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "503",
          orderName: "#503",
          bundleId: "bundle-r2f7-timeout",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Timeout Frame",
          status: "PENDING",
        },
      });

      const timeoutFetch = vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as unknown as typeof fetch;

      await expect(
        processDispatch(shop.id, orderTimeout.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          fetch: timeoutFetch,
        }),
      ).rejects.toThrow("aborted due to timeout");

      const timeoutDb = await prisma.labOrder.findUnique({ where: { id: orderTimeout.id } });
      expect(timeoutDb?.status).toBe("FAILED");
      expect(timeoutDb?.lastErrorCode).toBe("STORAGE_FAILED");
      expect(sentEmails).toHaveLength(0);
    });

    it("R2-F9: transitionToSending uses a single JS Date parameter for both write and stale cutoff", async () => {
      const shop = await seedShop("shop-r2f9-date.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r2f9",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r2f9`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "601",
          orderName: "#601",
          bundleId: "bundle-r2f9",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Date Param Frame",
          status: "PENDING",
        },
      });

      // Pass an explicit now Date
      const fixedNow = new Date("2026-11-08T12:00:00.000Z");
      const trans = await transitionToSending(shop.id, order.id, prisma, 15 * 60 * 1000, fixedNow);
      expect(trans.transitioned).toBe(true);

      const dbOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(dbOrder?.status).toBe("SENDING");
      expect(dbOrder?.updatedAt.toISOString()).toBe(fixedNow.toISOString());
    });
  });

  describe("Queue Integration with real Postgres", () => {
    it("runs dispatchJob through real pg-boss test queue and updates order to SENT", async () => {
      const shop = await seedShop("queue-test-shop.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-queue-real",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-queue-real`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "9001",
          orderName: "#9001",
          bundleId: "bundle-queue-real",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Queue Real Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      await withTestQueue(async (queue) => {
        // Register worker handler with injected mock mailer & store
        await queue.work({
          ...dispatchJob,
          handler: createDispatchHandler({
            db: prisma,
            cipher,
            objectStore,
            mailer,
          }),
        });

        // Enqueue the dispatch job with { labOrderId }
        await queue.enqueue(dispatchJob.name, {
          labOrderId: order.id,
        });

        // Poll for completion
        let isSent = false;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const row = await prisma.labOrder.findUnique({ where: { id: order.id } });
          if (row?.status === "SENT") {
            isSent = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        expect(isSent).toBe(true);
        expect(sentEmails).toHaveLength(1);
      });
    });
  });
});
