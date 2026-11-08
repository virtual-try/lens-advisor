import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { action as ordersCreateWebhookAction } from "../../app/routes/webhooks.orders.create";
import { loader as labOrdersListLoader } from "../../app/routes/app.lab-orders._index";
import {
  action as labOrderDetailAction,
  loader as labOrderDetailLoader,
} from "../../app/routes/app.lab-orders.$id";
import {
  intakeJob,
  type IntakeJobPayload,
  INTAKE_JOB_NAME,
} from "../../app/features/lab-orders/jobs.server";
import {
  dispatchJob,
  type DispatchJobPayload,
  DISPATCH_JOB_NAME,
} from "../../app/features/lab-dispatch/jobs.server";
import { buildTicketKey } from "../../app/shared/storage/object-store.server";
import { createPrescriptionsService } from "../../app/features/prescriptions/prescriptions.service.server";
import {
  createActionArgs,
  createAdminUrl,
  createAuthHeaders,
  createLoaderArgs,
  createSignedWebhookRequest,
  unwrapData,
} from "../helpers/shopify-auth";
import {
  setMockOrder,
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import {
  createMockMailer,
  createMockObjectStore,
  setupStorageAndMailerMocks,
  teardownStorageAndMailerMocks,
} from "../helpers/storage-mail-mock";
import { setupQueueMock, teardownQueueMock } from "../helpers/queue-mock";
import { seedLens, seedLensGroup, seedSettings, seedShop } from "../helpers/seed";

test.describe("Spec 33 Flows 11 & 12: Orders intake and lab dispatch (compliance-webhooks, admin-lab-orders)", () => {
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

  test("Flow 11: Webhook orders/create intake -> lab order dispatch (PDF ticket uploaded, mail sent, status SENT)", async () => {
    test.fixme(
      true,
      "Spec 35: web-definitions.server.ts unconditionally invokes Vite import.meta.glob which crashes outside Vite runtime"
    );
    setMockPlanActive(true);
    const domain = "orders-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    // 1. Settings with lab email and PDF ticket format
    await seedSettings(shopId, {
      labEmail: ["lab@optical-lab.example"],
      ticketFormat: "PDF",
    });

    // 2. Catalog: lens group and lens
    const group = await seedLensGroup(shopId, { name: "Single Vision" });
    const lens = await seedLens(shopId, {
      groupId: group.id,
      name: "Standard Clear 1.50",
      priceMinor: 2900,
      currency: "USD",
      rxTypes: ["SINGLE_VISION"],
      sphMin: -6,
      sphMax: 4,
      cylMin: -2,
      cylMax: 2,
    });

    // 3. Create prescription
    const rxService = createPrescriptionsService({ db: db.prisma });
    const rx = await rxService.submitPrescriptionByDomain(domain, {
      rxType: "SINGLE_VISION",
      prescription: {
        od: { sph: -200, cyl: -50, axis: 90 },
        os: { sph: -200, cyl: -50, axis: 85 },
        pd: { single: 630 },
      },
    });

    // 4. Configure Shopify mock order with bundle lines
    const shopifyOrderId = "9988776655";
    const bundleId = "bundle-flow-11";
    setMockOrder(shopifyOrderId, {
      id: `gid://shopify/Order/${shopifyOrderId}`,
      name: "#1099",
      lineItems: {
        nodes: [
          {
            id: "gid://shopify/LineItem/101",
            title: "Classic Frame",
            sku: "FRAME-01",
            customAttributes: [
              { key: "_bundle_id", value: bundleId },
              { key: "_bundle_role", value: "frame" },
            ],
          },
          {
            id: "gid://shopify/LineItem/102",
            title: "Standard Clear 1.50",
            sku: "LENS-01",
            customAttributes: [
              { key: "_bundle_id", value: bundleId },
              { key: "_bundle_role", value: "lens" },
              { key: "_item_id", value: lens.id },
              { key: "_rx_ref", value: rx.rxRef },
            ],
          },
        ],
      },
    });

    const mockQueue = setupQueueMock();
    try {
      // 5. Send signed orders/create webhook
      const webhookReq = createSignedWebhookRequest(
        "/webhooks/orders/create",
        "orders/create",
        domain,
        { id: shopifyOrderId, admin_graphql_api_id: `gid://shopify/Order/${shopifyOrderId}` }
      );
      const webhookRes = await ordersCreateWebhookAction(createActionArgs(webhookReq));
      expect(webhookRes.status).toBe(200);

      // 6. Assert webhook enqueued intake job; capture its payload
      const intakeJobs = mockQueue.findJobs(INTAKE_JOB_NAME);
      expect(intakeJobs.length).toBe(1);
      const intakePayload = intakeJobs[0].payload as IntakeJobPayload;
      expect(intakePayload.shopDomain).toBe(domain);
      expect(intakePayload.shopifyOrderId).toBe(shopifyOrderId);

      // 7. Execute real intake handler with captured payload
      const jobContext = {
        jobId: "mock-intake-job",
        retryCount: 0,
        signal: new AbortController().signal,
      };
      await intakeJob.handler(intakePayload, jobContext);

      // 8. Assert intake job enqueued dispatch job; capture its payload
      const dispatchJobs = mockQueue.findJobs(DISPATCH_JOB_NAME);
      expect(dispatchJobs.length).toBe(1);
      const dispatchPayload = dispatchJobs[0].payload as DispatchJobPayload;
      expect(dispatchPayload.labOrderId).toBeTruthy();

      // 9. Execute real dispatch handler with captured payload
      await dispatchJob.handler(dispatchPayload, {
        ...jobContext,
        jobId: "mock-dispatch-job",
      });

      // 10. Assert DB status is SENT
      const updatedLabOrder = await db.prisma.labOrder.findUnique({
        where: { id: dispatchPayload.labOrderId },
      });
      expect(updatedLabOrder).not.toBeNull();
      expect(updatedLabOrder?.status).toBe("SENT");
      expect(updatedLabOrder?.sentAt).not.toBeNull();

      // 11. Assert ticket PDF exists in object storage
      const ticketKey = buildTicketKey(shopId, dispatchPayload.labOrderId, "pdf");
      expect(mockStore.storedObjects.has(ticketKey)).toBe(true);

      // 12. Assert dispatch email was sent with PDF attachment
      expect(mockMailer.sentMails.length).toBe(1);
      const mail = mockMailer.sentMails[0];
      expect(mail.to).toEqual(["lab@optical-lab.example"]);
      expect(mail.attachments?.length).toBe(1);
      expect(mail.attachments?.[0].filename).toBe(`ticket-${dispatchPayload.labOrderId}.pdf`);
    } finally {
      teardownQueueMock();
    }
  });

  test("Flow 12: Resend failed lab order -> resets to PENDING, transitions to SENT with timestamp", async () => {
    test.fixme(
      true,
      "Spec 35: web-definitions.server.ts unconditionally invokes Vite import.meta.glob which crashes outside Vite runtime"
    );
    setMockPlanActive(true);
    const domain = "resend-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    await seedSettings(shopId, {
      labEmail: ["lab@optical-lab.example"],
      ticketFormat: "PDF",
    });

    const group = await seedLensGroup(shopId, { name: "SV Resend" });
    const lens = await seedLens(shopId, {
      groupId: group.id,
      name: "Resend Lens",
      priceMinor: 2900,
      currency: "USD",
      rxTypes: ["SINGLE_VISION"],
      sphMin: -6,
      sphMax: 4,
      cylMin: -2,
      cylMax: 2,
    });

    const rxService = createPrescriptionsService({ db: db.prisma });
    const rx = await rxService.submitPrescriptionByDomain(domain, {
      rxType: "SINGLE_VISION",
      prescription: {
        od: { sph: -150, cyl: 0, axis: 90 },
        os: { sph: -150, cyl: 0, axis: 90 },
        pd: { single: 620 },
      },
    });

    // Seed a lab order in FAILED status
    const failedOrder = await db.prisma.labOrder.create({
      data: {
        shopId,
        shopifyOrderId: "88887777",
        orderName: "#1088",
        bundleId: "bundle-failed-1",
        lensId: lens.id,
        prescriptionId: rx.rxRef,
        status: "FAILED",
        lastErrorCode: "EMAIL_REJECTED",
        frameTitle: "Frame X",
        attempts: 2,
      },
    });

    const mockQueue = setupQueueMock();
    try {
      // 1. Exercise list path: load lab orders list
      const listReq = new Request(createAdminUrl("/app/lab-orders", domain), {
        headers: createAuthHeaders(domain),
      });
      const listRes = await labOrdersListLoader(createLoaderArgs(listReq));
      const listData = await unwrapData<{ orders: Array<{ id: string; status: string }> }>(listRes);
      expect(listData.orders.some((o) => o.id === failedOrder.id)).toBe(true);

      // 2. Exercise detail path: open lab order detail
      const detailReq = new Request(
        createAdminUrl(`/app/lab-orders/${failedOrder.id}`, domain),
        { headers: createAuthHeaders(domain) }
      );
      const detailRes = await labOrderDetailLoader(
        createLoaderArgs(detailReq, { id: failedOrder.id })
      );
      const detailData = await unwrapData<{ order: { id: string; status: string } }>(detailRes);
      expect(detailData.order.id).toBe(failedOrder.id);
      expect(detailData.order.status).toBe("FAILED");

      // 3. Trigger Resend via admin detail action
      const req = new Request(createAdminUrl(`/app/lab-orders/${failedOrder.id}`, domain), {
        method: "POST",
        headers: {
          ...createAuthHeaders(domain),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "intent=resend",
      });
      const res = await labOrderDetailAction(
        createActionArgs(req, { id: failedOrder.id })
      );

      const actionData = await unwrapData<{ ok: boolean; resent?: boolean }>(res);
      expect(actionData.ok).toBe(true);

      // 4. Verify order transitioned to PENDING in DB
      const pendingOrder = await db.prisma.labOrder.findUnique({
        where: { id: failedOrder.id },
      });
      expect(pendingOrder).not.toBeNull();
      expect(pendingOrder?.status).toBe("PENDING");

      // 5. Assert exactly one dispatch job was captured
      const dispatchJobs = mockQueue.findJobs(DISPATCH_JOB_NAME);
      expect(dispatchJobs.length).toBe(1);
      const dispatchJobEntry = dispatchJobs[0];
      expect(dispatchJobEntry.payload).toEqual({ labOrderId: failedOrder.id });

      // 6. Execute real dispatch handler with captured job payload (no manual handler calls)
      const beforeDispatch = new Date();
      await dispatchJob.handler(dispatchJobEntry.payload as DispatchJobPayload, {
        jobId: "mock-resend-dispatch",
        retryCount: 0,
        signal: new AbortController().signal,
      });

      // 7. Verify order transitioned to SENT with new timestamp
      const sentOrder = await db.prisma.labOrder.findUnique({
        where: { id: failedOrder.id },
      });
      expect(sentOrder).not.toBeNull();
      expect(sentOrder?.status).toBe("SENT");
      expect(sentOrder?.sentAt).not.toBeNull();
      expect(new Date(sentOrder!.sentAt!).getTime()).toBeGreaterThanOrEqual(
        beforeDispatch.getTime() - 1000
      );
    } finally {
      teardownQueueMock();
    }
  });
});
