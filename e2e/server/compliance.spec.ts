import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { getSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { runShopRedact } from "../../app/features/compliance/redact.server";
import {
  createMockMailer,
  createMockObjectStore,
  setupStorageAndMailerMocks,
  teardownStorageAndMailerMocks,
} from "../helpers/storage-mail-mock";
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

  test("Flow 13: Compliance shop/redact -> shop rows and S3 prefix gone", async () => {
    setMockPlanActive(true);
    const domain = "redact-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    // Seed shop data
    await seedSettings(shopId, {
      labEmail: ["lab@redact-test.example"],
      ticketFormat: "PDF",
    });
    const group = await seedLensGroup(shopId, { name: "Redact Group" });

    // Seed S3 objects under shop prefix
    const shopPrefix = `shops/${shopId}/`;
    const ticketKey = `${shopPrefix}tickets/order-1/ticket.pdf`;
    const rxKey = `${shopPrefix}prescriptions/rx-1.png`;
    mockStore.storedObjects.set(ticketKey, { body: Buffer.from("pdf-data"), contentType: "application/pdf" });
    mockStore.storedObjects.set(rxKey, { body: Buffer.from("png-data"), contentType: "image/png" });

    expect(mockStore.storedObjects.has(ticketKey)).toBe(true);
    expect(mockStore.storedObjects.has(rxKey)).toBe(true);

    // Verify DB rows exist
    const shopBefore = await db.prisma.shop.findUnique({ where: { id: shopId } });
    expect(shopBefore).not.toBeNull();
    const groupBefore = await db.prisma.lensGroup.findUnique({ where: { id: group.id } });
    expect(groupBefore).not.toBeNull();

    // Execute runShopRedact
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
      shopId,
      complianceRequestId: "compliance-req-123",
    });

    // Verify shop rows are deleted from DB (INV-10: every model with shopId is empty for the redacted shop)
    const shopAfter = await db.prisma.shop.findUnique({ where: { id: shopId } });
    expect(shopAfter).toBeNull();
    const settingsAfter = await db.prisma.shopSettings.findUnique({ where: { shopId } });
    expect(settingsAfter).toBeNull();
    const groupAfter = await db.prisma.lensGroup.findUnique({ where: { id: group.id } });
    expect(groupAfter).toBeNull();

    const modelsWithShopId = Prisma.dmmf.datamodel.models.filter((m) =>
      m.fields.some((f) => f.name === "shopId")
    );
    for (const model of modelsWithShopId) {
      const delegateName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const delegate = (db.prisma as unknown as Record<string, { count: (args: { where: { shopId: string } }) => Promise<number> }>)[delegateName];
      if (delegate && typeof delegate.count === "function") {
        const count = await delegate.count({ where: { shopId } });
        expect(count, `Expected model ${model.name} to have 0 rows for shopId ${shopId}`).toBe(0);
      }
    }

    // Verify S3 prefix is deleted
    expect(mockStore.storedObjects.has(ticketKey)).toBe(false);
    expect(mockStore.storedObjects.has(rxKey)).toBe(false);
  });
});
