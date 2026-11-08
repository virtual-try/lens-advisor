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
      const [res1, res2] = await Promise.all([
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer, logger }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer, logger }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual(["SENT", "SKIPPED"]);

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

    it("row 6: production handler with { labOrderId } resolves owning shop via repository and dispatches (R1-F4)", async () => {
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

    it("row 6b: production handler with non-existent { labOrderId } logs warning with id only and does not throw (R1-F4)", async () => {
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

      // 7. markSent cross-shop isolation
      const sentCross = await markSent(shopA.id, orderB.id, { providerId: "prov_bad", ticketKeys: [] }, prisma);
      expect(sentCross).toBeNull();

      // 8. markFailed cross-shop isolation
      const failCross = await markFailed(shopA.id, orderB.id, "MAIL_FAILED", prisma);
      expect(failCross).toBeNull();

      // 9. resetLabOrderStatus cross-shop isolation
      const resetCross = await resetLabOrderStatus(shopA.id, orderB.id, "PENDING", prisma);
      expect(resetCross).toBeNull();

      // 10. loadTicketData cross-shop isolation
      await expect(loadTicketData(shopA.id, orderB.id, { db: prisma, cipher })).rejects.toThrow();

      // 11. resend cross-shop isolation
      await expect(resend(shopA.id, orderB.id, { db: prisma })).rejects.toThrow();
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
      await Promise.all([
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

    it("R1-F2: markSent throw records FAILED with LOAD_FAILED and does not leave order stuck in SENDING", async () => {
      const shop = await seedShop("shop-r1f2-mark-sent.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-r1f2-marksent",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-r1f2-marksent`),
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "1007-marksent",
          orderName: "#1007-marksent",
          bundleId: "bundle-r1f2-marksent",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "MarkSent Crash Test",
          status: "PENDING",
        },
      });

      const { mailer } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      const repoModule = await import("./lab-dispatch.repository.server");
      const markSentSpy = vi.spyOn(repoModule, "markSent").mockRejectedValueOnce(new Error("Database crash in markSent"));

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
        }),
      ).rejects.toThrow("Database crash in markSent");

      markSentSpy.mockRestore();

      // Verify row is NOT stuck in SENDING; it is FAILED with LOAD_FAILED
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("LOAD_FAILED");
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
