import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { getSharedTestDb, resetSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { runShopRedact } from "../../app/features/compliance/redact.server";
import { action as complianceWebhookAction } from "../../app/routes/webhooks.compliance";
import { shopRedactJob } from "../../app/features/compliance/jobs.server";
import type { ShopRedactPayload } from "../../app/features/compliance/schema";
import {
  createActionArgs,
  createSignedWebhookRequest,
} from "../helpers/shopify-auth";
import {
  createMockMailer,
  createMockObjectStore,
  setupStorageAndMailerMocks,
  teardownStorageAndMailerMocks,
} from "../helpers/storage-mail-mock";
import { setupQueueMock, teardownQueueMock } from "../helpers/queue-mock";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedShop, seedLensGroup, seedSettings } from "../helpers/seed";
import type { ComplianceDeps } from "../../app/features/compliance/deps.server";
import type { Queue } from "../../app/shared/queue/queue";
import type { FieldCipher } from "../../app/shared/crypto/field-cipher.server";

test.describe("Spec 33 Flow 13: Compliance shop/redact (compliance-webhooks)", () => {
  let db: TestDb;
  let mockStore: ReturnType<typeof createMockObjectStore>;
  let mockMailer: ReturnType<typeof createMockMailer>;

  test.beforeAll(async () => {
    db = await getSharedTestDb();
    setupShopifyMock();
    const mocks = setupStorageAndMailerMocks();
    mockStore = mocks.mockStore;
    mockMailer = mocks.mockMailer;
  });

  test.afterAll(async () => {
    teardownStorageAndMailerMocks();
    teardownShopifyMock();
  });

  test.beforeEach(async () => {
    await resetSharedTestDb();
  });

  test("Flow 13: Compliance shop/redact -> shop rows and S3 prefix gone while preserving other shops", async () => {
    setMockPlanActive(true);
    expect(await db.prisma.shop.count()).toBe(0);

    // Seed shop A (target for redaction)
    const domainA = "redact-flow-shop-a.myshopify.com";
    const { shopId: shopIdA } = await seedShop(db.prisma, domainA);

    await seedSettings(shopIdA, {
      labEmail: ["lab@redact-test.example"],
      ticketFormat: "PDF",
    });
    const groupA = await seedLensGroup(shopIdA, { name: "Redact Group A" });

    const shopPrefixA = `shops/${shopIdA}/`;
    const ticketKeyA = `${shopPrefixA}tickets/order-1/ticket.pdf`;
    const rxKeyA = `${shopPrefixA}prescriptions/rx-1.png`;
    mockStore.storedObjects.set(ticketKeyA, { body: Buffer.from("pdf-data"), contentType: "application/pdf" });
    mockStore.storedObjects.set(rxKeyA, { body: Buffer.from("png-data"), contentType: "image/png" });

    // Seed shop B (must be preserved across shop A's redaction)
    const domainB = "preserve-flow-shop-b.myshopify.com";
    const { shopId: shopIdB } = await seedShop(db.prisma, domainB);

    await seedSettings(shopIdB, {
      labEmail: ["lab@preserve-test.example"],
      ticketFormat: "PDF",
    });
    const groupB = await seedLensGroup(shopIdB, { name: "Preserve Group B" });

    const shopPrefixB = `shops/${shopIdB}/`;
    const ticketKeyB = `${shopPrefixB}tickets/order-b/ticket.pdf`;
    const rxKeyB = `${shopPrefixB}prescriptions/rx-b.png`;
    mockStore.storedObjects.set(ticketKeyB, { body: Buffer.from("pdf-b-data"), contentType: "application/pdf" });
    mockStore.storedObjects.set(rxKeyB, { body: Buffer.from("png-b-data"), contentType: "image/png" });

    expect(mockStore.storedObjects.has(ticketKeyA)).toBe(true);
    expect(mockStore.storedObjects.has(rxKeyA)).toBe(true);
    expect(mockStore.storedObjects.has(ticketKeyB)).toBe(true);
    expect(mockStore.storedObjects.has(rxKeyB)).toBe(true);

    // Verify DB rows exist for both shops before redaction
    expect(await db.prisma.shop.findUnique({ where: { id: shopIdA } })).not.toBeNull();
    expect(await db.prisma.lensGroup.findUnique({ where: { id: groupA.id } })).not.toBeNull();
    expect(await db.prisma.shop.findUnique({ where: { id: shopIdB } })).not.toBeNull();
    expect(await db.prisma.lensGroup.findUnique({ where: { id: groupB.id } })).not.toBeNull();

    // Execute runShopRedact for shop A
    const deps: ComplianceDeps = {
      prisma: db.prisma,
      queue: {
        enqueue: async () => "mock-job-id",
        registerAll: async () => {},
        start: async () => {},
        stop: async () => {},
      } as unknown as Queue,
      objectStore: mockStore,
      mailer: mockMailer,
      cipher: {} as unknown as FieldCipher,
      logger: { info: () => {} },
      shopContactEmail: async () => null,
    };

    await runShopRedact(deps, {
      shopId: shopIdA,
      complianceRequestId: "compliance-req-123",
    });

    // Verify shop A rows are deleted from DB (INV-10: every model with shopId is empty for the redacted shop)
    const shopAAfter = await db.prisma.shop.findUnique({ where: { id: shopIdA } });
    expect(shopAAfter).toBeNull();
    const settingsAAfter = await db.prisma.shopSettings.findUnique({ where: { shopId: shopIdA } });
    expect(settingsAAfter).toBeNull();
    const groupAAfter = await db.prisma.lensGroup.findUnique({ where: { id: groupA.id } });
    expect(groupAAfter).toBeNull();

    const modelsWithShopId = Prisma.dmmf.datamodel.models.filter((m) =>
      m.fields.some((f) => f.name === "shopId")
    );
    for (const model of modelsWithShopId) {
      const delegateName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const delegate = (db.prisma as unknown as Record<string, { count: (args: { where: { shopId: string } }) => Promise<number> }>)[delegateName];
      if (delegate && typeof delegate.count === "function") {
        const count = await delegate.count({ where: { shopId: shopIdA } });
        expect(count, `Expected model ${model.name} to have 0 rows for redacted shopId ${shopIdA}`).toBe(0);
      }
    }

    // Verify S3 prefix for shop A is deleted
    expect(mockStore.storedObjects.has(ticketKeyA)).toBe(false);
    expect(mockStore.storedObjects.has(rxKeyA)).toBe(false);

    // Verify shop B rows and S3 objects remain untouched (cross-shop preservation)
    const shopBAfter = await db.prisma.shop.findUnique({ where: { id: shopIdB } });
    expect(shopBAfter).not.toBeNull();
    const settingsBAfter = await db.prisma.shopSettings.findUnique({ where: { shopId: shopIdB } });
    expect(settingsBAfter).not.toBeNull();
    const groupBAfter = await db.prisma.lensGroup.findUnique({ where: { id: groupB.id } });
    expect(groupBAfter).not.toBeNull();
    expect(mockStore.storedObjects.has(ticketKeyB)).toBe(true);
    expect(mockStore.storedObjects.has(rxKeyB)).toBe(true);
  });

  test("Flow 13 (webhook route): Signed shop/redact webhook enqueues redact job -> consumes job and deletes shop A while preserving shop B", async () => {
    test.fixme(
      true,
      "Spec 35: web-definitions.server.ts unconditionally invokes Vite import.meta.glob which crashes outside Vite runtime"
    );
    setMockPlanActive(true);
    const domainA = "webhook-redact-shop-a.myshopify.com";
    const { shopId: shopIdA } = await seedShop(db.prisma, domainA);
    await seedSettings(shopIdA, {
      labEmail: ["lab@webhook-redact.example"],
      ticketFormat: "PDF",
    });
    const groupA = await seedLensGroup(shopIdA, { name: "Redact Webhook Group A" });
    const ticketKeyA = `shops/${shopIdA}/tickets/order-a/ticket.pdf`;
    const rxKeyA = `shops/${shopIdA}/prescriptions/rx-a.png`;
    mockStore.storedObjects.set(ticketKeyA, { body: Buffer.from("pdf-a"), contentType: "application/pdf" });
    mockStore.storedObjects.set(rxKeyA, { body: Buffer.from("png-a"), contentType: "image/png" });

    const domainB = "webhook-preserve-shop-b.myshopify.com";
    const { shopId: shopIdB } = await seedShop(db.prisma, domainB);
    await seedSettings(shopIdB, {
      labEmail: ["lab@webhook-preserve.example"],
      ticketFormat: "PDF",
    });
    const groupB = await seedLensGroup(shopIdB, { name: "Preserve Webhook Group B" });
    const ticketKeyB = `shops/${shopIdB}/tickets/order-b/ticket.pdf`;
    const rxKeyB = `shops/${shopIdB}/prescriptions/rx-b.png`;
    mockStore.storedObjects.set(ticketKeyB, { body: Buffer.from("pdf-b"), contentType: "application/pdf" });
    mockStore.storedObjects.set(rxKeyB, { body: Buffer.from("png-b"), contentType: "image/png" });

    const mockQueue = setupQueueMock();
    try {
      // Send signed shop/redact webhook
      const webhookReq = createSignedWebhookRequest(
        "/webhooks/compliance",
        "shop/redact",
        domainA,
        { shop_id: 12345, shop_domain: domainA }
      );
      const webhookRes = await complianceWebhookAction(createActionArgs(webhookReq));
      expect(webhookRes.status).toBe(200);

      // Assert queue captured the shop/redact job
      const redactJobs = mockQueue.findJobs(shopRedactJob.name);
      expect(redactJobs.length).toBe(1);
      const redactPayload = redactJobs[0].payload as ShopRedactPayload;
      expect(redactPayload.shopId).toBe(shopIdA);

      // Run captured job through the real handler
      await shopRedactJob.handler(redactPayload, {
        jobId: "mock-job-shop-redact",
        retryCount: 0,
        signal: new AbortController().signal,
      });

      // Verify shop A is deleted
      const shopAAfter = await db.prisma.shop.findUnique({ where: { id: shopIdA } });
      expect(shopAAfter).toBeNull();
      const settingsAAfter = await db.prisma.shopSettings.findUnique({ where: { shopId: shopIdA } });
      expect(settingsAAfter).toBeNull();
      const groupAAfter = await db.prisma.lensGroup.findUnique({ where: { id: groupA.id } });
      expect(groupAAfter).toBeNull();
      expect(mockStore.storedObjects.has(ticketKeyA)).toBe(false);
      expect(mockStore.storedObjects.has(rxKeyA)).toBe(false);

      // Verify shop B is preserved
      const shopBAfter = await db.prisma.shop.findUnique({ where: { id: shopIdB } });
      expect(shopBAfter).not.toBeNull();
      const settingsBAfter = await db.prisma.shopSettings.findUnique({ where: { shopId: shopIdB } });
      expect(settingsBAfter).not.toBeNull();
      const groupBAfter = await db.prisma.lensGroup.findUnique({ where: { id: groupB.id } });
      expect(groupBAfter).not.toBeNull();
      expect(mockStore.storedObjects.has(ticketKeyB)).toBe(true);
      expect(mockStore.storedObjects.has(rxKeyB)).toBe(true);
    } finally {
      teardownQueueMock();
    }
  });
});
