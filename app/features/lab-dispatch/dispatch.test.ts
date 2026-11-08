import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getCipher } from "../../shared/container/cipher.server";
import type { Mailer, SendMailOptions } from "../../shared/mail/mailer.server";
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
        name: "Premium Lenses",
        position: 0,
      },
    });

    const lens = await prisma.lens.create({
      data: {
        shopId,
        groupId: group.id,
        name: "Ultra Thin 1.67",
        priceMinor: 7500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
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
      presignDownload: vi.fn(async ({ key }: { key: string }) => `https://s3.example.test/download/${key}`),
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

      // Create prescription with sensitive values
      const rxRow = await prisma.prescription.create({
        data: {
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-row1`),
          id: "rx-row1",
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
          optionValueIds: catalog.optionValues.map((v) => v.id),
          addOnIds: [catalog.addOn.id],
          frameTitle: "Classic Acetate",
          frameSku: "FRAME-101",
          rxOutOfLimits: false,
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

      // Verify DB row updated to SENT
      const updatedOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updatedOrder?.status).toBe("SENT");
      expect(updatedOrder?.providerId).toBe(result.providerId);
      expect(updatedOrder?.sentAt).not.toBeNull();
      expect(updatedOrder?.attempts).toBe(1);
      expect(updatedOrder?.lastErrorCode).toBeNull();
      expect(updatedOrder?.ticketKeys).toHaveLength(2);

      // Verify 2 objects in S3 (PDF and CSV)
      const expectedPdfKey = buildTicketKey(shop.id, order.id, "pdf");
      const expectedCsvKey = buildTicketKey(shop.id, order.id, "csv");
      expect(storedObjects.has(expectedPdfKey)).toBe(true);
      expect(storedObjects.has(expectedCsvKey)).toBe(true);

      // Verify 1 email sent with 2 tickets attached to 2 lab emails
      expect(sentEmails).toHaveLength(1);
      const email = sentEmails[0];
      expect(email.to).toEqual(["lab1@example.test", "lab2@example.test"]);
      expect(email.attachments).toHaveLength(2);
      expect(email.attachments?.some((a) => a.filename === `${order.id}.pdf`)).toBe(true);
      expect(email.attachments?.some((a) => a.filename === `${order.id}.csv`)).toBe(true);
      expect(email.idempotencyKey).toBe(`${order.id}:1`);
    });

    it("row 2: UPLOAD Rx with 2 files -> the 2 files attached as well (uploads)", async () => {
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

      // Mock S3 file reader for the 2 uploaded files
      const file1Buffer = Buffer.from("DUMMY_PDF_PRESCRIPTION_CONTENT");
      const file2Buffer = Buffer.from("DUMMY_PNG_IMAGE_CONTENT");
      const s3Reader = vi.fn(async (key: string) => {
        if (key === fileKey1) return file1Buffer;
        if (key === fileKey2) return file2Buffer;
        throw new Error("Key not found in mock");
      });

      const result = await processDispatch(shop.id, order.id, {
        db: prisma,
        cipher,
        objectStore,
        mailer,
        logger,
        s3Reader,
      });

      expect(result.status).toBe("SENT");
      expect(sentEmails).toHaveLength(1);

      const email = sentEmails[0];
      // Format is BOTH: 2 ticket attachments (pdf, csv) + 2 uploaded prescription files = 4 attachments
      expect(email.attachments).toHaveLength(4);
      expect(email.attachments?.some((a) => a.content.equals(file1Buffer))).toBe(true);
      expect(email.attachments?.some((a) => a.content.equals(file2Buffer))).toBe(true);
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
          frameTitle: "Round Titanium",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      // Run two dispatches concurrently on the same order
      const [res1, res2] = await Promise.all([
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          logger,
        }),
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          logger,
        }),
      ]);

      // Exactly one succeeds and marks SENT; the other is SKIPPED
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual(["SENT", "SKIPPED"]);

      // Exactly one email sent
      expect(sentEmails).toHaveLength(1);

      // Exactly 1 SENT row in DB
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("SENT");
    });

    it("row 4: mailer throws -> FAILED MAIL_FAILED, attempts+1, job retried (retry)", async () => {
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

      // Mailer that throws on send
      const failingMailer: Mailer = {
        send: vi.fn().mockRejectedValue(new Error("Resend network timeout")),
      };
      const { objectStore } = createFakeObjectStore();
      const { logger } = createCapturingLogger();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer: failingMailer,
          logger,
        }),
      ).rejects.toThrow();

      // Verify row is FAILED, lastErrorCode is MAIL_FAILED, attempts incremented by 1
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("MAIL_FAILED");
      expect(updated?.attempts).toBe(1);
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
          frameTitle: "Classic",
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

      // Provider not called
      expect(sentEmails).toHaveLength(0);

      // Row status FAILED
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("NO_LAB_EMAIL");
    });

    it("row 6: labOrderId of shop B in job for shop A -> handler loads nothing, logs id only (INV-1)", async () => {
      const shopA = await seedShop("shop-row6a.example.test");
      const shopB = await seedShop("shop-row6b.example.test");
      const catalogB = await seedCatalog(shopB.id);

      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "1006",
          orderName: "#1006",
          bundleId: "bundle-row6",
          lensId: catalogB.lens.id,
          frameTitle: "Shop B Frame",
          status: "PENDING",
        },
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { mailer, sentEmails } = createFakeMailer();

      const handler = createDispatchHandler({
        db: prisma,
        mailer,
      });

      // Dispatch job for shop A with shop B's order ID
      await handler({ labOrderId: orderB.id, shopId: shopA.id });

      // Verifies: handler loads nothing, sends no email, order B stays untouched
      expect(sentEmails).toHaveLength(0);
      const untouchedOrderB = await prisma.labOrder.findUnique({ where: { id: orderB.id } });
      expect(untouchedOrderB?.status).toBe("PENDING");
      expect(untouchedOrderB?.attempts).toBe(0);

      // Verifies: logged ID only
      expect(warnSpy).toHaveBeenCalled();
      const logCalls = warnSpy.mock.calls.flat().join(" ");
      expect(logCalls).toContain(orderB.id);
      expect(logCalls).toContain(shopA.id);

      warnSpy.mockRestore();
    });

    it("row 7: Rx ciphertext tampered -> FAILED RX_DECRYPT_FAILED, no email (integrity)", async () => {
      const shop = await seedShop("shop-row7.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      // Create a valid ciphertext, then tamper with its bytes
      const validToken = cipher.encrypt(sensitiveRx, `${shop.id}:rx-row7`);
      const tamperedToken = validToken.slice(0, -6) + "XXXXXX";

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
          frameTitle: "Tampered Frame",
          status: "PENDING",
        },
      });

      const { mailer, sentEmails } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();
      const { logger, calls } = createCapturingLogger();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          logger,
        }),
      ).rejects.toThrow("RX_DECRYPT_FAILED");

      // No email sent
      expect(sentEmails).toHaveLength(0);

      // Order marked FAILED with RX_DECRYPT_FAILED
      const updated = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.lastErrorCode).toBe("RX_DECRYPT_FAILED");

      // Logs recorded event without leaking any Rx
      const loggedError = calls.find((c) => c.level === "error");
      expect(loggedError?.event).toBe("lab_dispatch.rx_decrypt_failed");
    });
  });

  describe("Invariants: INV-1, INV-2, INV-8", () => {
    it("INV-1: every repository query is tested with two shops (no cross-shop read or write)", async () => {
      const shopA = await seedShop("inv1-shop-a.example.test");
      const shopB = await seedShop("inv1-shop-b.example.test");
      const catA = await seedCatalog(shopA.id);
      const catB = await seedCatalog(shopB.id);
      const cipher = getCipher();

      const rxA = await prisma.prescription.create({
        data: {
          id: "rx-inv1-a",
          shopId: shopA.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt({ od: { sph: -200 } }, `${shopA.id}:rx-inv1-a`),
        },
      });
      const rxB = await prisma.prescription.create({
        data: {
          id: "rx-inv1-b",
          shopId: shopB.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt({ od: { sph: -400 } }, `${shopB.id}:rx-inv1-b`),
        },
      });

      const orderA = await prisma.labOrder.create({
        data: {
          shopId: shopA.id,
          shopifyOrderId: "2001",
          orderName: "#2001",
          bundleId: "bundle-a",
          prescriptionId: rxA.id,
          lensId: catA.lens.id,
          frameTitle: "Frame A",
          status: "PENDING",
        },
      });
      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopB.id,
          shopifyOrderId: "2002",
          orderName: "#2002",
          bundleId: "bundle-b",
          prescriptionId: rxB.id,
          lensId: catB.lens.id,
          frameTitle: "Frame B",
          status: "PENDING",
        },
      });

      // 1. getLabOrder
      expect(await getLabOrder(shopA.id, orderB.id, prisma)).toBeNull();
      expect(await getLabOrder(shopB.id, orderA.id, prisma)).toBeNull();
      expect(await getLabOrder(shopA.id, orderA.id, prisma)).not.toBeNull();

      // 2. transitionToSending: shop A cannot transition shop B's order
      const transFail = await transitionToSending(shopA.id, orderB.id, prisma);
      expect(transFail.transitioned).toBe(false);
      const bUntouched = await getLabOrder(shopB.id, orderB.id, prisma);
      expect(bUntouched?.status).toBe("PENDING");

      // 3. markSent: shop A cannot mark shop B's order SENT
      const markSentFail = await markSent(
        shopA.id,
        orderB.id,
        { providerId: "evil", ticketKeys: [] },
        prisma,
      );
      expect(markSentFail).toBeNull();
      const bStillPending = await getLabOrder(shopB.id, orderB.id, prisma);
      expect(bStillPending?.status).toBe("PENDING");

      // 4. markFailed: shop A cannot mark shop B's order FAILED
      const markFailedFail = await markFailed(shopA.id, orderB.id, "TEST_ERR", prisma);
      expect(markFailedFail).toBeNull();
      expect((await getLabOrder(shopB.id, orderB.id, prisma))?.status).toBe("PENDING");

      // 5. resetLabOrderStatus: shop A cannot reset shop B's order
      const resetFail = await resetLabOrderStatus(shopA.id, orderB.id, "SENT", prisma);
      expect(resetFail).toBeNull();
      expect((await getLabOrder(shopB.id, orderB.id, prisma))?.status).toBe("PENDING");

      // 6. getPrescription: shop A cannot read shop B's prescription
      expect(await getPrescription(shopA.id, rxB.id, prisma)).toBeNull();
      expect(await getPrescription(shopB.id, rxA.id, prisma)).toBeNull();
      expect(await getPrescription(shopA.id, rxA.id, prisma)).not.toBeNull();

      // 7. getLens: shop A cannot read shop B's lens
      expect(await getLens(shopA.id, catB.lens.id, prisma)).toBeNull();
      expect(await getLens(shopB.id, catA.lens.id, prisma)).toBeNull();
      expect(await getLens(shopA.id, catA.lens.id, prisma)).not.toBeNull();

      // 8. getOptionValues: shop A cannot read shop B's option values
      const bOptionIds = catB.optionValues.map((v) => v.id);
      expect(await getOptionValues(shopA.id, bOptionIds, prisma)).toEqual([]);
      const aOptionIds = catA.optionValues.map((v) => v.id);
      expect(await getOptionValues(shopB.id, aOptionIds, prisma)).toEqual([]);

      // 9. getAddOns: shop A cannot read shop B's add-ons
      expect(await getAddOns(shopA.id, [catB.addOn.id], prisma)).toEqual([]);
      expect(await getAddOns(shopB.id, [catA.addOn.id], prisma)).toEqual([]);

      // 10. loadTicketData: shop A cannot load ticket data for shop B's order
      await expect(loadTicketData(shopA.id, orderB.id, { db: prisma, cipher })).rejects.toThrow();

      // 11. resend: shop A cannot resend shop B's order
      await expect(resend(shopA.id, orderB.id, { db: prisma })).rejects.toThrow();
    });

    it("INV-2: a logger spy across the failure rows finds no Rx value or clinical data", async () => {
      const shop = await seedShop("inv2-logger.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const distinctiveClinicalText = "DISTINCTIVE_PATIENT_CLINICAL_NOTES_789456";
      const distinctiveSphValue = "-9.87";
      const sensitivePayload = {
        od: { sph: -987, cyl: -225, axis: 180 },
        os: { sph: -987, cyl: -225, axis: 180 },
        pd: { single: 630 },
        notes: distinctiveClinicalText,
      };

      const validToken = cipher.encrypt(sensitivePayload, `${shop.id}:rx-inv2`);
      const tamperedToken = validToken.slice(0, -6) + "TAMPER";

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-inv2",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: tamperedToken,
        },
      });

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "3001",
          orderName: "#3001",
          bundleId: "bundle-inv2",
          prescriptionId: rxRow.id,
          lensId: catalog.lens.id,
          frameTitle: "Titanium Frame",
          status: "PENDING",
        },
      });

      const { logger, calls } = createCapturingLogger();
      const { mailer } = createFakeMailer();
      const { objectStore } = createFakeObjectStore();

      await expect(
        processDispatch(shop.id, order.id, {
          db: prisma,
          cipher,
          objectStore,
          mailer,
          logger,
        }),
      ).rejects.toThrow();

      // Assert that none of the logged entries contain clinical Rx values or notes
      const serializedLogs = JSON.stringify(calls);
      expect(serializedLogs).not.toContain(distinctiveClinicalText);
      expect(serializedLogs).not.toContain(distinctiveSphValue);
      expect(serializedLogs).not.toContain("-987");

      // Check stored order lastErrorCode has no clinical data
      const failedOrder = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(failedOrder?.lastErrorCode).toBe("RX_DECRYPT_FAILED");
      expect(failedOrder?.lastErrorCode).not.toContain(distinctiveClinicalText);
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

      // 4 concurrent dispatch attempts on the exact same order
      const results = await Promise.all([
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
        processDispatch(shop.id, order.id, { db: prisma, cipher, objectStore, mailer }),
      ]);

      const sentCount = results.filter((r) => r.status === "SENT").length;
      const skippedCount = results.filter((r) => r.status === "SKIPPED").length;

      expect(sentCount).toBe(1);
      expect(skippedCount).toBe(3);
      expect(sentEmails).toHaveLength(1);

      const dbRow = await prisma.labOrder.findUnique({ where: { id: order.id } });
      expect(dbRow?.status).toBe("SENT");
      expect(dbRow?.attempts).toBe(1);
    });
  });

  describe("Self-check & Edge Cases", () => {
    it("Self-check 1: transitionToSending is a single conditional UPDATE; returns false when already SENDING or SENT", async () => {
      const shop = await seedShop("sc1-shop.example.test");
      const catalog = await seedCatalog(shop.id);

      const order = await prisma.labOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: "5001",
          orderName: "#5001",
          bundleId: "bundle-sc1",
          lensId: catalog.lens.id,
          frameTitle: "SC1 Frame",
          status: "PENDING",
        },
      });

      // 1. First transition from PENDING -> SENDING succeeds
      const first = await transitionToSending(shop.id, order.id, prisma);
      expect(first.transitioned).toBe(true);
      expect(first.attempts).toBe(1);

      // 2. Second transition while SENDING fails (count = 0)
      const second = await transitionToSending(shop.id, order.id, prisma);
      expect(second.transitioned).toBe(false);
      expect(second.attempts).toBe(0);

      // 3. Mark SENT
      await markSent(shop.id, order.id, { providerId: "prov1", ticketKeys: [] }, prisma);

      // 4. Third transition while SENT fails
      const third = await transitionToSending(shop.id, order.id, prisma);
      expect(third.transitioned).toBe(false);

      // 5. If marked FAILED, transition from FAILED -> SENDING succeeds
      await markFailed(shop.id, order.id, "MAIL_FAILED", prisma);
      const fourth = await transitionToSending(shop.id, order.id, prisma);
      expect(fourth.transitioned).toBe(true);
      expect(fourth.attempts).toBe(2);
    });

    it("Self-check 3: archived lenses still render on old orders", async () => {
      const shop = await seedShop("sc3-archived-lens.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      // Soft-delete (archive) the lens
      await prisma.lens.update({
        where: { id: catalog.lens.id },
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
          frameTitle: "Archived Lens Order",
          status: "PENDING",
        },
      });

      // loadTicketData succeeds and loads the archived lens name & template
      const ticketData = await loadTicketData(shop.id, order.id, { db: prisma, cipher });
      expect(ticketData.lensName).toBe("Ultra Thin 1.67");
      expect(ticketData.labCodeTemplate).toBe("PO/58_[material=PLASTIC]_[tint=CLEAR]");

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

    it("ticketFormat variations: PDF only, CSV only, BOTH", async () => {
      const shop = await seedShop("format-test-shop.example.test");
      const catalog = await seedCatalog(shop.id);
      const cipher = getCipher();

      const rxRow = await prisma.prescription.create({
        data: {
          id: "rx-format",
          shopId: shop.id,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: cipher.encrypt(sensitiveRx, `${shop.id}:rx-format`),
        },
      });

      // Test PDF only
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
          frameTitle: "Frame PDF",
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

      // Test CSV only
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
          frameTitle: "Frame CSV",
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

    it("resend service: resets order to PENDING and enqueues dispatch job", async () => {
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

      const fakeQueue = {
        enqueue: vi.fn(async () => "job_123"),
      };

      const res = await resend(shop.id, order.id, {
        db: prisma,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queue: fakeQueue as any,
      });

      expect(res.enqueued).toBe(true);
      expect(fakeQueue.enqueue).toHaveBeenCalledWith(
        DISPATCH_JOB_NAME,
        { labOrderId: order.id, shopId: shop.id },
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

        // Enqueue the dispatch job
        await queue.enqueue(dispatchJob.name, {
          labOrderId: order.id,
          shopId: shop.id,
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
