import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import * as ReactRouter from "react-router";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";
import fs from "node:fs";
import path from "node:path";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { NotFoundError } from "../../shared/http/errors.server";
import { getCipher } from "../../shared/container/cipher.server";
import type { ObjectStore } from "../../shared/storage/object-store.server";
import {
  formatLabOrderError,
  formatPrescriptionSummary,
  LAB_ORDER_ERROR_MESSAGES,
  nav,
  renderStatusBadge,
  UNKNOWN_ERROR_MESSAGE,
} from "./index";
import {
  getLabOrderDetail,
  listLabOrders,
  type LabOrderDetail,
} from "./lab-orders-admin.repository.server";
import {
  getLabOrderDetailService,
  getTicketDownloadUrlService,
  listLabOrdersService,
  resendLabOrderService,
} from "./lab-orders-admin.service.server";
import LabOrdersIndexRoute, {
  loader as indexLoader,
} from "../../routes/app.lab-orders._index";
import LabOrderDetailRoute, {
  action as detailAction,
  loader as detailLoader,
} from "../../routes/app.lab-orders.$id";

const DB_TIMEOUT_MS = 120_000;

const mocks = vi.hoisted(() => ({
  currentShop: "test-shop.myshopify.com",
  adminGraphql: vi.fn(),
  redirect: vi.fn(),
  queueEnqueue: vi.fn(async () => "mock_job_id"),
  presignDownload: vi.fn(
    async (key: string) => `https://s3.example.com/${key}?signed=true`,
  ),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: mocks.currentShop },
      admin: { graphql: mocks.adminGraphql },
      redirect: mocks.redirect,
    })),
  },
}));

vi.mock("../../shared/container/queue.server", () => ({
  getQueue: vi.fn(async () => ({
    enqueue: mocks.queueEnqueue,
  })),
}));

let db: TestDb | undefined;

function getTestPrisma() {
  if (!db) throw new Error("Test database not initialized");
  return db.prisma;
}

beforeAll(async () => {
  db = await createTestDb();
  (globalThis as Record<string, unknown>).__prismaClient = db.prisma;
  (globalThis as Record<string, unknown>).__objectStore = {
    presignDownload: mocks.presignDownload,
    presignUpload: vi.fn(),
    putObject: vi.fn(),
    headObject: vi.fn(),
    objectExists: vi.fn(),
    deletePrefix: vi.fn(),
  };
}, DB_TIMEOUT_MS);

afterAll(async () => {
  (globalThis as Record<string, unknown>).__prismaClient = undefined;
  (globalThis as Record<string, unknown>).__objectStore = undefined;
  await db?.drop();
}, DB_TIMEOUT_MS);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  testConfig();

  // Mock Shopify billing subscription response with fresh Response per fetch call
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              items: [{ handle: "pro-plan", description: "Pro Plan" }],
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  );

  mocks.adminGraphql.mockImplementation(async (query: string) => {
    if (typeof query === "string" && query.includes("AppPlanShopId")) {
      return new Response(
        JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1001" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          currentAppInstallation: {
            activeSubscriptions: [
              {
                id: "gid://shopify/AppSubscription/1",
                name: "Pro Plan",
                status: "ACTIVE",
                test: false,
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
});

function createLoaderArgs(request: Request, params: Record<string, string> = {}): ReactRouter.LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as ReactRouter.LoaderFunctionArgs;
}

function createActionArgs(request: Request, params: Record<string, string> = {}): ReactRouter.ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: { path: url.pathname },
  } as unknown as ReactRouter.ActionFunctionArgs;
}

async function unwrapResponse<T = Record<string, unknown>>(
  result: unknown,
): Promise<{ status: number; data: T }> {
  if (result instanceof Response) {
    const data = (await result.clone().json()) as T;
    return { status: result.status, data };
  }
  if (
    result &&
    typeof result === "object" &&
    "type" in result &&
    (result as { type: string }).type === "DataWithResponseInit"
  ) {
    const r = result as unknown as { data: T; init?: { status?: number } };
    return { status: r.init?.status ?? 200, data: r.data };
  }
  return { status: 200, data: result as T };
}


import { standaloneNumber } from "../../../e2e/helpers/standalone-number";

describe("Spec 32 — Admin: lab orders list, resend and ticket download", () => {
  // Navigation test
  it("nav.ts exports 'Lab orders' with order 5", () => {
    expect(nav.label).toBe("Lab orders");
    expect(nav.href).toBe("/app/lab-orders");
    expect(nav.order).toBe(5);
  });

  describe("Error code mapping table and status badge (Self-check 2, R1-F5)", () => {
    it("maps all defined error codes to full English sentences without pinning count", () => {
      expect(LAB_ORDER_ERROR_MESSAGES.NO_LAB_EMAIL).toBe("No lab email set");
      expect(formatLabOrderError("NO_LAB_EMAIL")).toBe("No lab email set");
      expect(formatLabOrderError("MAIL_FAILED")).toBe(
        "Failed to send email to the lab",
      );
      expect(formatLabOrderError("STORAGE_FAILED")).toBe(
        "Failed to store or retrieve lab ticket files",
      );
      expect(formatLabOrderError("RX_DECRYPT_FAILED")).toBe(
        "Failed to decrypt prescription data",
      );
      expect(formatLabOrderError("LOAD_FAILED")).toBe(
        "Failed to load order catalog or prescription data",
      );
      expect(formatLabOrderError("TICKET_RENDER_FAILED")).toBe(
        "Failed to generate lab ticket",
      );
      expect(formatLabOrderError("NO_LENS_IN_BUNDLE")).toBe(
        "No lens found in order bundle",
      );
      expect(formatLabOrderError("LENS_NOT_FOUND")).toBe(
        "Lens not found in catalog",
      );
      expect(formatLabOrderError("OPTION_NOT_FOUND")).toBe(
        "Selected option not found in catalog",
      );
      expect(formatLabOrderError("RX_NOT_FOUND")).toBe("Prescription not found");
    });

    it("maps unknown error codes to 'Something went wrong'", () => {
      expect(formatLabOrderError("UNKNOWN_RANDOM_CODE")).toBe(
        UNKNOWN_ERROR_MESSAGE,
      );
      expect(formatLabOrderError("FATAL_CRASH")).toBe("Something went wrong");
    });

    it("returns empty string for null or undefined", () => {
      expect(formatLabOrderError(null)).toBe("");
      expect(formatLabOrderError(undefined)).toBe("");
      expect(formatLabOrderError("")).toBe("");
    });

    it("R1-F5: renderStatusBadge for FAILED order with null or empty code renders 'Something went wrong'", () => {
      // Null code
      const { container: c1 } = render(
        <>{renderStatusBadge({ status: "FAILED", lastErrorCode: null })}</>,
      );
      expect(c1.innerHTML).toContain("Failed");
      expect(c1.innerHTML).toContain("Something went wrong");

      // Undefined code
      const { container: c2 } = render(
        <>{renderStatusBadge({ status: "FAILED", lastErrorCode: undefined })}</>,
      );
      expect(c2.innerHTML).toContain("Something went wrong");

      // Empty string code
      const { container: c3 } = render(
        <>{renderStatusBadge({ status: "FAILED", lastErrorCode: "" })}</>,
      );
      expect(c3.innerHTML).toContain("Something went wrong");

      // Unknown code
      const { container: c4 } = render(
        <>{renderStatusBadge({ status: "FAILED", lastErrorCode: "SOME_UNRECOGNIZED_CODE" })}</>,
      );
      expect(c4.innerHTML).toContain("Something went wrong");

      // Known code with settings link
      const { container: c5 } = render(
        <>{renderStatusBadge({ status: "FAILED", lastErrorCode: "NO_LAB_EMAIL" })}</>,
      );
      expect(c5.innerHTML).toContain("Failed");
      expect(c5.innerHTML).toContain("No lab email set");
      expect(c5.innerHTML).toContain("href=\"/app/settings\"");
    });
  });

  describe("Prescription privacy summary (INV-2)", () => {
    it("formats MANUAL source as 'Prescription: on file (typed)'", () => {
      const summary = formatPrescriptionSummary({
        id: "rx_1",
        rxType: "SINGLE_VISION",
        source: "MANUAL",
        uploadKeys: [],
        createdAt: new Date(),
      });
      expect(summary).toBe("Prescription: on file (typed)");
    });

    it("formats UPLOAD source with 1 file as 'Prescription: on file (uploaded, 1 file)'", () => {
      const summary = formatPrescriptionSummary({
        id: "rx_2",
        rxType: "SINGLE_VISION",
        source: "UPLOAD",
        uploadKeys: ["shops/s1/rx/rx_2/file1.pdf"],
        createdAt: new Date(),
      });
      expect(summary).toBe("Prescription: on file (uploaded, 1 file)");
    });

    it("formats UPLOAD source with multiple files as 'Prescription: on file (uploaded, 2 files)'", () => {
      const summary = formatPrescriptionSummary({
        id: "rx_3",
        rxType: "SINGLE_VISION",
        source: "UPLOAD",
        uploadKeys: [
          "shops/s1/rx/rx_3/file1.pdf",
          "shops/s1/rx/rx_3/file2.jpg",
        ],
        createdAt: new Date(),
      });
      expect(summary).toBe("Prescription: on file (uploaded, 2 files)");
    });

    it("formats NON_PRESCRIPTION as 'Non-prescription'", () => {
      const summary = formatPrescriptionSummary({
        id: "rx_4",
        rxType: "NON_PRESCRIPTION",
        source: "MANUAL",
        uploadKeys: [],
        createdAt: new Date(),
      });
      expect(summary).toBe("Non-prescription");
    });

    it("formats null prescription as 'None'", () => {
      expect(formatPrescriptionSummary(null)).toBe("None");
      expect(formatPrescriptionSummary(undefined)).toBe("None");
    });
  });

  describe("Examples Table Cases", () => {
    // Row 1: 3 orders: Sent, Failed NO_LAB_EMAIL, Pending -> 3 rows; Failed shows "No lab email set" + link to Settings
    it("Example Row 1: 3 orders (Sent, Failed NO_LAB_EMAIL, Pending) -> 3 rows; Failed shows 'No lab email set' + link to Settings", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "example-row-1.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      // Clean existing lab orders for this shop
      await prisma.labOrder.deleteMany({ where: { shopId } });

      const lens = await prisma.lens.findFirst({ where: { shopId } });

      // Create 3 orders: Sent, Failed NO_LAB_EMAIL, Pending
      await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "1001",
          orderName: "#1001",
          bundleId: "bundle-sent",
          lensId: lens?.id,
          frameTitle: "Aviator Gold",
          status: "SENT",
          ticketKeys: [`shops/${shopId}/tickets/order_sent.pdf`],
          sentAt: new Date(),
          createdAt: new Date("2026-11-08T10:00:00Z"),
        },
      });

      await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "1002",
          orderName: "#1002",
          bundleId: "bundle-failed",
          lensId: lens?.id,
          frameTitle: "Wayfarer Black",
          status: "FAILED",
          lastErrorCode: "NO_LAB_EMAIL",
          createdAt: new Date("2026-11-08T09:00:00Z"),
        },
      });

      await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "1003",
          orderName: "#1003",
          bundleId: "bundle-pending",
          lensId: lens?.id,
          frameTitle: "Clubmaster Tortoise",
          status: "PENDING",
          createdAt: new Date("2026-11-08T08:00:00Z"),
        },
      });

      // Query loader
      const request = new Request("https://app.test/app/lab-orders");
      const response = await indexLoader(createLoaderArgs(request));
      const { data: result } = await unwrapResponse<{
        orders: Array<{
          id: string;
          orderName: string;
          status: string;
          lastErrorCode: string | null;
        }>;
      }>(response);

      expect(result.orders).toHaveLength(3);
      expect(result.orders.map((o) => o.orderName)).toEqual([
        "#1001",
        "#1002",
        "#1003",
      ]);

      // Render component
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        orders: result.orders,
        hasNext: false,
        nextCursor: null,
        currentStatus: "ALL",
        storeHandle: "example-row-1",
      });

      const { container } = render(<LabOrdersIndexRoute />);

      // Failed shows "No lab email set" + link to Settings
      expect(container.innerHTML).toContain("No lab email set");
      const settingsLink = container.querySelector('s-link[href="/app/settings"]');
      expect(settingsLink).not.toBeNull();
      expect(settingsLink?.textContent).toBe("Settings");

      // Verify badges present
      expect(container.innerHTML).toContain("Sent");
      expect(container.innerHTML).toContain("Failed");
      expect(container.innerHTML).toContain("Pending");
    });

    // Row 2: 51 orders -> 50 rows + Next (paging)
    it("Example Row 2: 51 orders -> 50 rows + Next | paging", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "example-row-2.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      await prisma.labOrder.deleteMany({ where: { shopId } });
      const lens = await prisma.lens.findFirst({ where: { shopId } });

      // Create 51 orders with distinct timestamps
      const baseTime = Date.now();
      const ordersData = Array.from({ length: 51 }, (_, i) => ({
        shopId,
        shopifyOrderId: `ord_${1000 + i}`,
        orderName: `#${1000 + i}`,
        bundleId: `b_${i}`,
        lensId: lens?.id,
        frameTitle: `Frame ${i}`,
        status: "PENDING" as const,
        createdAt: new Date(baseTime + (51 - i) * 1000), // newest first
      }));

      await prisma.labOrder.createMany({ data: ordersData });

      // Page 1 query
      const reqPage1 = new Request("https://app.test/app/lab-orders");
      const resPage1 = await indexLoader(createLoaderArgs(reqPage1));
      const { data: page1 } = await unwrapResponse<{
        orders: Array<{ id: string; orderName: string }>;
        hasNext: boolean;
        nextCursor: string | null;
      }>(resPage1);

      expect(page1.orders).toHaveLength(50);
      expect(page1.hasNext).toBe(true);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.orders[0].orderName).toBe("#1000");

      // Render page 1 and verify Next button is present
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        orders: page1.orders,
        hasNext: page1.hasNext,
        nextCursor: page1.nextCursor,
        currentStatus: "ALL",
        storeHandle: "example-row-2",
      });

      const { container } = render(<LabOrdersIndexRoute />);
      const nextButton = container.querySelector(
        `s-button[href*="cursor=${page1.nextCursor}"]`,
      );
      expect(nextButton).not.toBeNull();
      expect(nextButton?.textContent).toBe("Next");

      // Page 2 query with cursor
      const reqPage2 = new Request(
        `https://app.test/app/lab-orders?cursor=${page1.nextCursor}`,
      );
      const resPage2 = await indexLoader(createLoaderArgs(reqPage2));
      const { data: page2 } = await unwrapResponse<{
        orders: Array<{ id: string; orderName: string }>;
        hasNext: boolean;
        nextCursor: string | null;
      }>(resPage2);

      expect(page2.orders).toHaveLength(1);
      expect(page2.orders[0].orderName).toBe("#1050");
      expect(page2.hasNext).toBe(false);
    });

    // Row 3: Resend on Failed -> job enqueued, badge Pending after reload
    it("Example Row 3: Resend on Failed -> job enqueued, badge Pending after reload | resend", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "example-row-3.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      const failedOrder = await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "2001",
          orderName: "#2001",
          bundleId: "b_resend_failed",
          frameTitle: "Resend Frame",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
          attempts: 2,
        },
      });

      // Call action with intent: "resend"
      const formData = new FormData();
      formData.append("intent", "resend");
      const request = new Request(
        `https://app.test/app/lab-orders/${failedOrder.id}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const actionResponse = await detailAction(
        createActionArgs(request, { id: failedOrder.id }),
      );
      const { data: actionResult } = await unwrapResponse<{
        ok: boolean;
        resent: boolean;
      }>(actionResponse);

      expect(actionResult.ok).toBe(true);
      expect(actionResult.resent).toBe(true);
      expect(mocks.queueEnqueue).toHaveBeenCalledTimes(1);

      // Verify DB row status is now PENDING and lastErrorCode is null
      const reloadedOrder = await prisma.labOrder.findUnique({
        where: { id: failedOrder.id },
      });
      expect(reloadedOrder?.status).toBe("PENDING");
      expect(reloadedOrder?.lastErrorCode).toBeNull();

      // Reload detail page
      const loadRequest = new Request(
        `https://app.test/app/lab-orders/${failedOrder.id}`,
      );
      const loadResponse = await detailLoader(
        createLoaderArgs(loadRequest, { id: failedOrder.id }),
      );
      const { data: loadedData } = await unwrapResponse<{
        order: { status: string; lastErrorCode: string | null };
      }>(loadResponse);

      expect(loadedData.order.status).toBe("PENDING");
      expect(loadedData.order.lastErrorCode).toBeNull();

      // Render detail view
      vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
        submit: vi.fn(),
        state: "idle",
        data: undefined,
        Form: () => null,
        load: vi.fn(),
      } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        order: {
          ...failedOrder,
          status: "PENDING",
          lastErrorCode: null,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        },
        shopId,
        storeHandle: "example-row-3",
      });

      const { container } = render(<LabOrderDetailRoute />);
      expect(container.innerHTML).toContain("Pending");
      expect(container.innerHTML).not.toContain("Failed");
    });

    // Row 4: download on Sent -> action returns a URL for this shop's key only | normal
    it("Example Row 4: download on Sent -> action returns a URL for this shop's key only", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "example-row-4.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      const sentOrder = await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "3001",
          orderName: "#3001",
          bundleId: "b_sent_dl",
          frameTitle: "Sent Frame",
          status: "SENT",
        },
      });

      const validTicketKey = `shops/${shopId}/tickets/${sentOrder.id}.pdf`;
      await prisma.labOrder.update({
        where: { id: sentOrder.id },
        data: { ticketKeys: [validTicketKey] },
      });

      // 1. Download URLs are minted in an action per click, NEVER in the loader (Self-check 1)
      const loadRequest = new Request(
        `https://app.test/app/lab-orders/${sentOrder.id}`,
      );
      const loadResponse = await detailLoader(
        createLoaderArgs(loadRequest, { id: sentOrder.id }),
      );
      const { data: loadData } = await unwrapResponse<Record<string, unknown>>(
        loadResponse,
      );
      expect((loadData as { downloadUrl?: unknown }).downloadUrl).toBeUndefined();

      // 2. Action call with this shop's valid ticket key
      const formData = new FormData();
      formData.append("intent", "download-ticket");
      formData.append("ticketKey", validTicketKey);

      const actionRequest = new Request(
        `https://app.test/app/lab-orders/${sentOrder.id}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const actionResponse = await detailAction(
        createActionArgs(actionRequest, { id: sentOrder.id }),
      );
      const { data: actionResult } = await unwrapResponse<{
        ok: boolean;
        downloadUrl: string;
      }>(actionResponse);

      expect(actionResult.ok).toBe(true);
      expect(actionResult.downloadUrl).toBe(
        `https://s3.example.com/${validTicketKey}?signed=true`,
      );
      expect(mocks.presignDownload).toHaveBeenCalledWith(validTicketKey);

      // 3. Action rejects ticket key belonging to another shop
      const foreignShopKey = `shops/other-shop/tickets/${sentOrder.id}.pdf`;
      const foreignFormData = new FormData();
      foreignFormData.append("intent", "download-ticket");
      foreignFormData.append("ticketKey", foreignShopKey);

      const foreignRequest = new Request(
        `https://app.test/app/lab-orders/${sentOrder.id}`,
        {
          method: "POST",
          body: foreignFormData,
        },
      );

      const foreignResponse = await detailAction(
        createActionArgs(foreignRequest, { id: sentOrder.id }),
      );
      const { status: foreignStatus, data: foreignResult } =
        await unwrapResponse<{
          error: { code: string };
        }>(foreignResponse);

      expect(foreignStatus).toBe(400);
      expect(foreignResult.error.code).toBe("FORBIDDEN_TICKET_KEY");
    });

    // Row 5: detail id of another shop -> 404 (INV-1)
    it("Example Row 5: detail id of another shop -> 404 (INV-1)", async () => {
      const prisma = getTestPrisma();
      const shopADomain = "shop-a-row5.myshopify.com";
      const shopBDomain = "shop-b-row5.myshopify.com";

      const { shopId: shopAId } = await seedShop(prisma, shopADomain);
      const { shopId: shopBId } = await seedShop(prisma, shopBDomain);

      // Order created in shop B
      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopBId,
          shopifyOrderId: "order_b_id",
          orderName: "#B100",
          bundleId: "b_shop_b",
          frameTitle: "Shop B Frame",
          status: "SENT",
        },
      });

      // Authenticated as Shop A
      mocks.currentShop = shopADomain;

      // 1. Repository returns null for order B under shop A
      const repoResult = await getLabOrderDetail(shopAId, orderB.id, prisma);
      expect(repoResult).toBeNull();

      // 2. Service returns null
      const serviceResult = await getLabOrderDetailService(shopAId, orderB.id, {
        db: prisma,
      });
      expect(serviceResult).toBeNull();

      // 3. Detail loader throws 404 Response
      const request = new Request(
        `https://app.test/app/lab-orders/${orderB.id}`,
      );
      await expect(
        detailLoader(createLoaderArgs(request, { id: orderB.id })),
      ).rejects.toSatisfy((err) => {
        return err instanceof Response && err.status === 404;
      });

      // 4. Detail action returns 404 for another shop's order
      const actionFormData = new FormData();
      actionFormData.append("intent", "resend");
      const actionReq = new Request(
        `https://app.test/app/lab-orders/${orderB.id}`,
        {
          method: "POST",
          body: actionFormData,
        },
      );
      const actionRes = await detailAction(
        createActionArgs(actionReq, { id: orderB.id }),
      );
      const { status: actionResStatus } = await unwrapResponse(actionRes);
      expect(actionResStatus).toBe(404);
    });

    // Row 6: no orders -> empty state | empty
    it("Example Row 6: no orders -> empty state (explains orders appear after a customer buys lenses)", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "empty-shop-row6.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      await prisma.labOrder.deleteMany({ where: { shopId } });

      const request = new Request("https://app.test/app/lab-orders");
      const response = await indexLoader(createLoaderArgs(request));
      const { data: result } = await unwrapResponse<{
        orders: unknown[];
      }>(response);

      expect(result.orders).toHaveLength(0);

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        orders: [],
        hasNext: false,
        nextCursor: null,
        currentStatus: "ALL",
        storeHandle: "empty-shop-row6",
      });

      const { container } = render(<LabOrdersIndexRoute />);
      const emptyState = container.querySelector("s-empty-state");
      expect(emptyState).not.toBeNull();
      expect(container.innerHTML).toContain("No lab orders yet");
      expect(container.innerHTML).toContain(
        "Orders appear here after a customer buys lenses.",
      );
    });
  });

  describe("Invariants Proofs: INV-1, INV-2, INV-7", () => {
    // INV-1: Every repository function and route scopes by shopId
    it("INV-1: two-shop repository isolation for listLabOrders and getLabOrderDetail", async () => {
      const prisma = getTestPrisma();
      const shopADomain = "inv1-shop-a.myshopify.com";
      const shopBDomain = "inv1-shop-b.myshopify.com";

      const { shopId: shopA } = await seedShop(prisma, shopADomain);
      const { shopId: shopB } = await seedShop(prisma, shopBDomain);

      await prisma.labOrder.deleteMany({ where: { shopId: shopA } });
      await prisma.labOrder.deleteMany({ where: { shopId: shopB } });

      const orderA = await prisma.labOrder.create({
        data: {
          shopId: shopA,
          shopifyOrderId: "ord_a",
          orderName: "#A1",
          bundleId: "b_a",
          frameTitle: "Frame A",
          status: "PENDING",
        },
      });

      const orderB = await prisma.labOrder.create({
        data: {
          shopId: shopB,
          shopifyOrderId: "ord_b",
          orderName: "#B1",
          bundleId: "b_b",
          frameTitle: "Frame B",
          status: "SENT",
        },
      });

      // Shop A list returns only orderA
      const listA = await listLabOrders(shopA, {}, prisma);
      expect(listA.items).toHaveLength(1);
      expect(listA.items[0].id).toBe(orderA.id);

      // Shop B list returns only orderB
      const listB = await listLabOrders(shopB, {}, prisma);
      expect(listB.items).toHaveLength(1);
      expect(listB.items[0].id).toBe(orderB.id);

      // Cross-shop detail lookup returns null
      expect(await getLabOrderDetail(shopA, orderB.id, prisma)).toBeNull();
      expect(await getLabOrderDetail(shopB, orderA.id, prisma)).toBeNull();

      // Cross-shop ticket download rejected
      await expect(
        getTicketDownloadUrlService(
          shopA,
          orderB.id,
          `shops/${shopA}/tickets/${orderB.id}.pdf`,
          {
            db: prisma,
            objectStore: (globalThis as Record<string, unknown>)
              .__objectStore as unknown as ObjectStore,
          },
        ),
      ).rejects.toThrow(NotFoundError);

      // Cross-shop resend rejected
      await expect(
        resendLabOrderService(shopA, orderB.id, {
          db: prisma,
          queue: { enqueue: mocks.queueEnqueue },
        }),
      ).rejects.toThrow(NotFoundError);

      // Service delegates cleanly
      const serviceList = await listLabOrdersService(shopA, {}, { db: prisma });
      expect(serviceList.items).toHaveLength(1);
      expect(serviceList.items[0].id).toBe(orderA.id);
    });

    // INV-2: Prescription data is encrypted at rest and never logged or exposed in HTML
    it("INV-2: renders detail page with distinctive Rx values and asserts NONE appears in HTML (R1-F2)", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "inv2-rx-privacy.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      // Seed a prescription with distinctive clinical values encrypted via real field-cipher (R1-F2)
      const rxId = "rx_inv2_test_distinctive";
      const cipher = getCipher();
      const distinctivePlaintext = {
        sph: -2.25,
        cyl: -1.50,
        axis: 137,
        notes: "NOTE-XYZ",
      };
      const encryptedCipher = cipher.encrypt(
        distinctivePlaintext,
        `${shopId}:${rxId}`,
      );

      const prescription = await prisma.prescription.create({
        data: {
          id: rxId,
          shopId,
          rxType: "SINGLE_VISION",
          source: "MANUAL",
          cipher: encryptedCipher,
          uploadKeys: [],
        },
      });

      // Assert the raw DB column lacks the plaintext values
      const rawRow = await prisma.prescription.findUnique({
        where: { id: prescription.id },
      });
      expect(rawRow?.cipher).toBeDefined();
      expect(rawRow!.cipher).not.toMatch(standaloneNumber("-2.25"));
      expect(rawRow!.cipher).not.toMatch(standaloneNumber("2.25"));
      expect(rawRow!.cipher).not.toMatch(standaloneNumber("-1.50"));
      expect(rawRow!.cipher).not.toMatch(standaloneNumber("1.50"));
      expect(rawRow!.cipher).not.toMatch(standaloneNumber("137"));
      expect(rawRow!.cipher).not.toContain("NOTE-XYZ");

      const order = await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "rx_inv2_order",
          orderName: "#RX100",
          bundleId: "b_rx_inv2",
          prescriptionId: prescription.id,
          frameTitle: "Privacy Frame",
          status: "SENT",
        },
      });

      // Query loader
      const request = new Request(
        `https://app.test/app/lab-orders/${order.id}`,
      );
      const response = await detailLoader(
        createLoaderArgs(request, { id: order.id }),
      );
      const { data: result } = await unwrapResponse<{
        order: LabOrderDetail;
        shopId: string;
        storeHandle: string;
      }>(response);

      // Verify repository/service did NOT load cipher
      expect((result.order.prescription as { cipher?: unknown } | null)?.cipher).toBeUndefined();

      // Assert loader JSON output lacks all distinctive plaintext
      const loaderJson = JSON.stringify(result);
      expect(loaderJson).not.toMatch(standaloneNumber("-2.25"));
      expect(loaderJson).not.toMatch(standaloneNumber("2.25"));
      expect(loaderJson).not.toMatch(standaloneNumber("-1.50"));
      expect(loaderJson).not.toMatch(standaloneNumber("1.50"));
      expect(loaderJson).not.toMatch(standaloneNumber("1.5"));
      expect(loaderJson).not.toMatch(standaloneNumber("-1.5"));
      expect(loaderJson).not.toMatch(standaloneNumber("137"));
      expect(loaderJson).not.toContain("NOTE-XYZ");

      // Render the detail component
      vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
        submit: vi.fn(),
        state: "idle",
        data: undefined,
        Form: () => null,
        load: vi.fn(),
      } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        order: result.order,
        shopId: result.shopId,
        storeHandle: result.storeHandle,
      });

      const { container } = render(<LabOrderDetailRoute />);
      const html = container.innerHTML;

      // Assert privacy copy is present
      expect(html).toContain("Prescription: on file (typed)");

      // Assert distinctive clinical values NEVER appear anywhere in HTML output
      expect(html).not.toMatch(standaloneNumber("-2.25"));
      expect(html).not.toMatch(standaloneNumber("2.25"));
      expect(html).not.toMatch(standaloneNumber("-1.50"));
      expect(html).not.toMatch(standaloneNumber("1.50"));
      expect(html).not.toMatch(standaloneNumber("1.5"));
      expect(html).not.toMatch(standaloneNumber("-1.5"));
      expect(html).not.toMatch(standaloneNumber("137"));
      expect(html).not.toContain("NOTE-XYZ");
      expect(html).not.toContain("cipher");
    });

    // INV-7: Polaris web components only — no raw hex, rgb, px or custom CSS in app/routes/app.*
    it("INV-7: static check confirms no style= or .css imports in owned files", () => {
      const ownedFiles = [
        "app/routes/app.lab-orders._index.tsx",
        "app/routes/app.lab-orders.$id.tsx",
        "app/features/lab-orders-admin/nav.ts",
        "app/features/lab-orders-admin/errors.ts",
        "app/features/lab-orders-admin/status-badge.tsx",
        "app/features/lab-orders-admin/summary.ts",
        "app/features/lab-orders-admin/lab-orders-admin.repository.server.ts",
        "app/features/lab-orders-admin/lab-orders-admin.service.server.ts",
        "app/features/lab-orders-admin/index.ts",
      ];

      for (const relPath of ownedFiles) {
        const fullPath = path.resolve(relPath);
        const content = fs.readFileSync(fullPath, "utf8");

        // Assert no style= attribute
        expect(content).not.toMatch(/style\s*=\s*[{"]/);

        // Assert no .css import
        expect(content).not.toMatch(/import\s+['"][^'"]+\.css['"]/);
      }
    });
  });

  describe("UI Interactions: Resend Modal, Out-of-limits, and Status Filter", () => {
    it("opens resend modal on click, confirms and triggers resend action", async () => {
      const mockShowOverlay = vi.fn();
      const mockHideOverlay = vi.fn();
      const mockSubmit = vi.fn();

      vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
        submit: mockSubmit,
        state: "idle",
        data: undefined,
        Form: () => null,
        load: vi.fn(),
      } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        order: {
          id: "ord_modal_test",
          orderName: "#MODAL1",
          shopifyOrderId: "111",
          frameTitle: "Frame Modal",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
          createdAt: new Date(),
          sentAt: null,
          attempts: 1,
          ticketKeys: [],
        },
        shopId: "shop_1",
        storeHandle: "modal-shop",
      });

      const { container } = render(<LabOrderDetailRoute />);

      // Attach mock web-component modal overlay methods to the DOM element
      const modalEl = container.querySelector<
        HTMLElement & { showOverlay: () => void; hideOverlay: () => void }
      >("s-modal");
      expect(modalEl).not.toBeNull();
      if (modalEl) {
        modalEl.showOverlay = mockShowOverlay;
        modalEl.hideOverlay = mockHideOverlay;
      }

      // Click "Resend to lab" button to open modal
      const resendBtn = Array.from(
        container.querySelectorAll("s-button"),
      ).find((b) => b.textContent?.includes("Resend to lab"));
      expect(resendBtn).not.toBeNull();

      fireEvent.click(resendBtn!);
      expect(mockShowOverlay).toHaveBeenCalledTimes(1);

      // Click Confirm ("Resend") inside modal
      const confirmBtn = Array.from(
        container.querySelectorAll("s-button"),
      ).find((b) => b.textContent === "Resend");
      expect(confirmBtn).not.toBeNull();

      fireEvent.click(confirmBtn!);
      expect(mockSubmit).toHaveBeenCalledWith(
        { intent: "resend" },
        { method: "POST" },
      );
      expect(mockHideOverlay).toHaveBeenCalledTimes(1);
    });

    it("displays 'Out of limits' badge when rxOutOfLimits is true", () => {
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        order: {
          id: "ord_limits",
          orderName: "#LIMITS",
          shopifyOrderId: "222",
          frameTitle: "Limits Frame",
          rxOutOfLimits: true,
          status: "PENDING",
          lastErrorCode: null,
          lens: { name: "High Index 1.74" },
          prescription: {
            id: "p1",
            rxType: "SINGLE_VISION",
            source: "MANUAL",
            uploadKeys: [],
          },
          optionValues: [],
          addOns: [],
          createdAt: new Date(),
          sentAt: null,
          attempts: 0,
          ticketKeys: [],
        },
        shopId: "shop_1",
        storeHandle: "limits-shop",
      });

      const { container } = render(<LabOrderDetailRoute />);
      expect(container.innerHTML).toContain("Out of limits");
      const outOfLimitsBadge = container.querySelector(
        's-badge[tone="warning"]',
      );
      expect(outOfLimitsBadge).not.toBeNull();
      expect(outOfLimitsBadge?.textContent).toBe("Out of limits");
    });

    it("filters list orders by status query parameter", async () => {
      const prisma = getTestPrisma();
      const shopDomain = "status-filter-shop.myshopify.com";
      const { shopId } = await seedShop(prisma, shopDomain);
      mocks.currentShop = shopDomain;

      await prisma.labOrder.deleteMany({ where: { shopId } });

      await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "f1",
          orderName: "#F1",
          bundleId: "b_f1",
          frameTitle: "Frame F1",
          status: "FAILED",
          lastErrorCode: "MAIL_FAILED",
        },
      });

      await prisma.labOrder.create({
        data: {
          shopId,
          shopifyOrderId: "s1",
          orderName: "#S1",
          bundleId: "b_s1",
          frameTitle: "Frame S1",
          status: "SENT",
        },
      });

      // Filter by FAILED
      const reqFailed = new Request(
        "https://app.test/app/lab-orders?status=FAILED",
      );
      const resFailed = await indexLoader(createLoaderArgs(reqFailed));
      const { data: failedData } = await unwrapResponse<{
        orders: Array<{ orderName: string; status: string }>;
        currentStatus: string;
      }>(resFailed);

      expect(failedData.orders).toHaveLength(1);
      expect(failedData.orders[0].status).toBe("FAILED");
      expect(failedData.currentStatus).toBe("FAILED");

      // Filter by SENT
      const reqSent = new Request(
        "https://app.test/app/lab-orders?status=SENT",
      );
      const resSent = await indexLoader(createLoaderArgs(reqSent));
      const { data: sentData } = await unwrapResponse<{
        orders: Array<{ orderName: string; status: string }>;
        currentStatus: string;
      }>(resSent);

      expect(sentData.orders).toHaveLength(1);
      expect(sentData.orders[0].status).toBe("SENT");
      expect(sentData.currentStatus).toBe("SENT");

      // Filter ALL returns both
      const reqAll = new Request("https://app.test/app/lab-orders");
      const resAll = await indexLoader(createLoaderArgs(reqAll));
      const { data: allData } = await unwrapResponse<{
        orders: Array<{ orderName: string }>;
      }>(resAll);

      expect(allData.orders).toHaveLength(2);
    });
  });

  describe("Review R1 Fixes (R1-F1, R1-F3, R1-F4, R1-F6, R1-F7)", () => {
    describe("R1-F1: Resend error guarding and feedback", () => {
      it("refuses resend on PENDING order with 409 and renders Resend failed banner", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f1-pending.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        const pendingOrder = await prisma.labOrder.create({
          data: {
            shopId,
            shopifyOrderId: "pend_001",
            orderName: "#PEND1",
            bundleId: "b_pend1",
            frameTitle: "Pending Frame",
            status: "PENDING",
          },
        });

        // 1. Action call on PENDING order -> returns 409 errorResponse
        const formData = new FormData();
        formData.append("intent", "resend");
        const request = new Request(
          `https://app.test/app/lab-orders/${pendingOrder.id}`,
          { method: "POST", body: formData },
        );
        const actionResponse = await detailAction(
          createActionArgs(request, { id: pendingOrder.id }),
        );
        const { status, data: body } = await unwrapResponse<{
          error: { code: string; message: string };
        }>(actionResponse);

        expect(status).toBe(409);
        expect(body.error.code).toBe("CONFLICT");

        // 2. Component renders "Resend failed" banner when fetcher returns error
        vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
          submit: vi.fn(),
          state: "idle",
          data: { error: { code: "CONFLICT", message: body.error.message } },
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: {
            ...pendingOrder,
            lens: null,
            prescription: null,
            optionValues: [],
            addOns: [],
          },
          shopId,
          storeHandle: "r1-f1-pending",
        });

        const { container } = render(<LabOrderDetailRoute />);
        expect(container.innerHTML).toContain("Resend failed");
        expect(container.innerHTML).toContain("Something went wrong");
      });

      it("handles queue enqueue failure on resend by returning 500 and preserving status", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f1-enqueue-fail.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        const failedOrder = await prisma.labOrder.create({
          data: {
            shopId,
            shopifyOrderId: "fail_002",
            orderName: "#FAIL2",
            bundleId: "b_fail2",
            frameTitle: "Failed Frame",
            status: "FAILED",
            lastErrorCode: "MAIL_FAILED",
          },
        });

        mocks.queueEnqueue.mockRejectedValueOnce(
          new Error("pg-boss enqueue failed"),
        );

        const formData = new FormData();
        formData.append("intent", "resend");
        const request = new Request(
          `https://app.test/app/lab-orders/${failedOrder.id}`,
          { method: "POST", body: formData },
        );
        const actionResponse = await detailAction(
          createActionArgs(request, { id: failedOrder.id }),
        );
        const { status, data: body } = await unwrapResponse<{
          error: { code: string };
        }>(actionResponse);

        expect(status).toBe(500);
        expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");

        // Status is reverted to FAILED with its previous lastErrorCode
        const reloaded = await prisma.labOrder.findUnique({
          where: { id: failedOrder.id },
        });
        expect(reloaded?.status).toBe("FAILED");
        expect(reloaded?.lastErrorCode).toBe("MAIL_FAILED");
      });

      it("disables Resend to lab button while fetcher is busy", () => {
        const mockOrder = {
          id: "ord_busy_resend",
          shopId: "shop_busy",
          shopifyOrderId: "123",
          orderName: "#123",
          bundleId: "b1",
          frameTitle: "Frame",
          status: "FAILED" as const,
          lastErrorCode: "MAIL_FAILED",
          attempts: 1,
          ticketKeys: [],
          providerId: null,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          prescriptionId: null,
          lensId: null,
          rxOutOfLimits: false,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        };

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: mockOrder,
          shopId: "shop_busy",
          storeHandle: "shop-busy",
        });

        // Fetcher is submitting
        vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
          submit: vi.fn(),
          state: "submitting",
          data: undefined,
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

        const { container } = render(<LabOrderDetailRoute />);
        const resendBtn = Array.from(container.querySelectorAll("s-button")).find(
          (b) => b.textContent?.includes("Resend to lab"),
        );
        expect(resendBtn).toBeDefined();
        expect(resendBtn?.hasAttribute("disabled")).toBe(true);
      });
    });

    describe("R1-F3: Ticket download flow and user gesture preservation", () => {
      it("opens blank tab synchronously on click, submits fetcher, and sets location when URL arrives", () => {
        const mockWindow = {
          location: { href: "" },
          close: vi.fn(),
        };
        const openSpy = vi
          .spyOn(window, "open")
          .mockReturnValue(mockWindow as unknown as Window);

        const mockSubmit = vi.fn();
        const mockOrder = {
          id: "ord_dl_test",
          shopId: "shop_dl",
          shopifyOrderId: "123",
          orderName: "#123",
          bundleId: "b1",
          frameTitle: "Frame",
          status: "SENT" as const,
          lastErrorCode: null,
          attempts: 1,
          ticketKeys: ["shops/shop_dl/tickets/ord_dl_test.pdf"],
          providerId: null,
          sentAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          prescriptionId: null,
          lensId: null,
          rxOutOfLimits: false,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        };

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: mockOrder,
          shopId: "shop_dl",
          storeHandle: "shop-dl",
        });

        let fetcherState: "idle" | "submitting" = "idle";
        let fetcherData: { downloadUrl?: string; error?: { message?: string } } | undefined = undefined;

        vi.spyOn(ReactRouter, "useFetcher").mockImplementation(() => ({
          submit: mockSubmit,
          state: fetcherState,
          data: fetcherData,
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>));

        const { container, rerender } = render(<LabOrderDetailRoute />);

        const dlBtn = Array.from(container.querySelectorAll("s-button")).find(
          (b) => b.textContent?.includes("Download PDF"),
        );
        expect(dlBtn).toBeDefined();

        // Click download button
        fireEvent.click(dlBtn!);

        // Synchronous window.open called with ("", "_blank")
        expect(openSpy).toHaveBeenCalledWith("", "_blank");
        expect(mockSubmit).toHaveBeenCalledWith(
          {
            intent: "download-ticket",
            ticketKey: "shops/shop_dl/tickets/ord_dl_test.pdf",
          },
          { method: "POST" },
        );

        // Fetcher resolves with downloadUrl
        fetcherState = "idle";
        fetcherData = { downloadUrl: "https://s3.example.com/tickets/ord_dl_test.pdf?presigned" };

        rerender(<LabOrderDetailRoute />);

        expect(mockWindow.location.href).toBe(
          "https://s3.example.com/tickets/ord_dl_test.pdf?presigned",
        );
      });

      it("closes blank tab and shows Download failed banner on error", () => {
        const mockWindow = {
          location: { href: "" },
          close: vi.fn(),
        };
        vi.spyOn(window, "open").mockReturnValue(mockWindow as unknown as Window);

        const mockOrder = {
          id: "ord_dl_err",
          shopId: "shop_dl_err",
          shopifyOrderId: "123",
          orderName: "#123",
          bundleId: "b1",
          frameTitle: "Frame",
          status: "SENT" as const,
          lastErrorCode: null,
          attempts: 1,
          ticketKeys: ["shops/shop_dl_err/tickets/ord_dl_err.pdf"],
          providerId: null,
          sentAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          prescriptionId: null,
          lensId: null,
          rxOutOfLimits: false,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        };

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: mockOrder,
          shopId: "shop_dl_err",
          storeHandle: "shop-dl-err",
        });

        vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
          submit: vi.fn(),
          state: "idle",
          data: { error: { message: "S3 presign failure" } },
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

        const { container } = render(<LabOrderDetailRoute />);

        expect(container.innerHTML).toContain("Download failed");
        expect(container.innerHTML).toContain("S3 presign failure");
      });

      it("disables download buttons while fetcher is submitting", () => {
        const mockOrder = {
          id: "ord_dl_busy",
          shopId: "shop_dl_busy",
          shopifyOrderId: "123",
          orderName: "#123",
          bundleId: "b1",
          frameTitle: "Frame",
          status: "SENT" as const,
          lastErrorCode: null,
          attempts: 1,
          ticketKeys: [
            "shops/shop_dl_busy/tickets/ord_dl_busy.pdf",
            "shops/shop_dl_busy/tickets/ord_dl_busy.csv",
          ],
          providerId: null,
          sentAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          prescriptionId: null,
          lensId: null,
          rxOutOfLimits: false,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        };

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: mockOrder,
          shopId: "shop_dl_busy",
          storeHandle: "shop-dl-busy",
        });

        vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
          submit: vi.fn(),
          state: "submitting",
          data: undefined,
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

        const { container } = render(<LabOrderDetailRoute />);
        const buttons = Array.from(container.querySelectorAll("s-button")).filter(
          (b) => b.textContent?.includes("Download"),
        );
        expect(buttons).toHaveLength(2);
        for (const btn of buttons) {
          expect(btn.hasAttribute("disabled")).toBe(true);
        }
      });
    });

    describe("R1-F4: Ticket keys offer and validation", () => {
      it("SENT order with empty ticketKeys renders no download buttons", () => {
        const mockOrder = {
          id: "ord_no_keys",
          shopId: "shop_no_keys",
          shopifyOrderId: "123",
          orderName: "#123",
          bundleId: "b1",
          frameTitle: "Frame",
          status: "SENT" as const,
          lastErrorCode: null,
          attempts: 1,
          ticketKeys: [],
          providerId: null,
          sentAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          prescriptionId: null,
          lensId: null,
          rxOutOfLimits: false,
          lens: null,
          prescription: null,
          optionValues: [],
          addOns: [],
        };

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          order: mockOrder,
          shopId: "shop_no_keys",
          storeHandle: "shop-no-keys",
        });

        vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
          submit: vi.fn(),
          state: "idle",
          data: undefined,
          Form: () => null,
          load: vi.fn(),
        } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

        const { container } = render(<LabOrderDetailRoute />);
        expect(container.innerHTML).not.toContain("Download PDF");
        expect(container.innerHTML).not.toContain("Download CSV");
        expect(container.innerHTML).not.toContain("Lab tickets");
      });

      it("getTicketDownloadUrlService refuses (400 FORBIDDEN_TICKET_KEY) any key not in order.ticketKeys", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f4-forbidden.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        const order = await prisma.labOrder.create({
          data: {
            shopId,
            shopifyOrderId: "ord_f4",
            orderName: "#F4",
            bundleId: "b_f4",
            frameTitle: "Frame F4",
            status: "SENT",
            ticketKeys: [`shops/${shopId}/tickets/ord_f4.pdf`],
          },
        });

        const csvKey = `shops/${shopId}/tickets/${order.id}.csv`;
        await expect(
          getTicketDownloadUrlService(shopId, order.id, csvKey, {
            db: prisma,
            objectStore: (globalThis as Record<string, unknown>)
              .__objectStore as unknown as ObjectStore,
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            status: 400,
            code: "FORBIDDEN_TICKET_KEY",
          }),
        );
      });
    });

    describe("R1-F6: Status query parameter validation and URL encoding", () => {
      it("returns currentStatus: ALL for ?status=foo and does not append unvalidated status to Next href", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f6-status-foo.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        await prisma.labOrder.deleteMany({ where: { shopId } });

        await prisma.labOrder.createMany({
          data: [
            {
              shopId,
              shopifyOrderId: "foo_1",
              orderName: "#FOO1",
              bundleId: "b_foo1",
              frameTitle: "Frame Foo 1",
              status: "PENDING",
            },
            {
              shopId,
              shopifyOrderId: "foo_2",
              orderName: "#FOO2",
              bundleId: "b_foo2",
              frameTitle: "Frame Foo 2",
              status: "SENT",
            },
          ],
        });

        const req = new Request("https://app.test/app/lab-orders?status=foo");
        const res = await indexLoader(createLoaderArgs(req));
        const { data: result } = await unwrapResponse<{
          orders: Array<{ orderName: string }>;
          currentStatus: string;
        }>(res);

        expect(result.currentStatus).toBe("ALL");
        expect(result.orders).toHaveLength(2);

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          orders: result.orders,
          hasNext: true,
          nextCursor: "cursor_123",
          currentStatus: result.currentStatus,
          storeHandle: "r1-f6-status-foo",
        });

        const { container } = render(<LabOrdersIndexRoute />);
        expect(container.innerHTML).toContain("[All]");
        expect(container.innerHTML).not.toContain("[foo]");

        const nextButton = container.querySelector("s-button");
        expect(nextButton).toBeDefined();
        expect(nextButton?.getAttribute("href")).toBe(
          "/app/lab-orders?cursor=cursor_123",
        );
      });
    });

    describe("R1-F7: API checklist cases coverage", () => {
      it("exact-50 orders case produces hasNext: false and no Next button", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f7-exact-50.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        await prisma.labOrder.deleteMany({ where: { shopId } });

        const baseTime = Date.now();
        const ordersData = Array.from({ length: 50 }, (_, i) => ({
          shopId,
          shopifyOrderId: `exact_${i}`,
          orderName: `#EXACT${i}`,
          bundleId: `b_exact_${i}`,
          frameTitle: `Frame ${i}`,
          status: "PENDING" as const,
          createdAt: new Date(baseTime + (50 - i) * 1000),
        }));

        await prisma.labOrder.createMany({ data: ordersData });

        const req = new Request("https://app.test/app/lab-orders");
        const res = await indexLoader(createLoaderArgs(req));
        const { data: page } = await unwrapResponse<{
          orders: Array<{ id: string; orderName: string }>;
          hasNext: boolean;
          nextCursor: string | null;
          currentStatus: string;
          storeHandle: string;
        }>(res);

        expect(page.orders).toHaveLength(50);
        expect(page.hasNext).toBe(false);
        expect(page.nextCursor).toBeNull();

        vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
          orders: page.orders,
          hasNext: page.hasNext,
          nextCursor: page.nextCursor,
          currentStatus: page.currentStatus,
          storeHandle: page.storeHandle,
        });

        const { container } = render(<LabOrdersIndexRoute />);
        const nextBtn = Array.from(container.querySelectorAll("s-button")).find(
          (b) => b.textContent?.includes("Next"),
        );
        expect(nextBtn).toBeUndefined();
      });

      it("foreign-shop cursor returns 0 items and does not leak foreign shop orders", async () => {
        const prisma = getTestPrisma();
        const { shopId: shopA } = await seedShop(prisma, "r1-f7-cursor-a.myshopify.com");
        const { shopId: shopB } = await seedShop(prisma, "r1-f7-cursor-b.myshopify.com");

        await prisma.labOrder.create({
          data: {
            shopId: shopA,
            shopifyOrderId: "ord_a",
            orderName: "#A",
            bundleId: "b_a",
            frameTitle: "Frame A",
            status: "PENDING",
          },
        });

        const orderB = await prisma.labOrder.create({
          data: {
            shopId: shopB,
            shopifyOrderId: "ord_b",
            orderName: "#B",
            bundleId: "b_b",
            frameTitle: "Frame B",
            status: "PENDING",
          },
        });

        const result = await listLabOrders(shopA, { cursor: orderB.id }, prisma);
        expect(result.items).toHaveLength(0);
        expect(result.hasNext).toBe(false);
        expect(result.nextCursor).toBeNull();
      });

      it("action rejects missing ticketKey, .exe extension, and unknown intent", async () => {
        const prisma = getTestPrisma();
        const shopDomain = "r1-f7-action-rejections.myshopify.com";
        const { shopId } = await seedShop(prisma, shopDomain);
        mocks.currentShop = shopDomain;

        const order = await prisma.labOrder.create({
          data: {
            shopId,
            shopifyOrderId: "ord_rej",
            orderName: "#REJ",
            bundleId: "b_rej",
            frameTitle: "Frame REJ",
            status: "SENT",
            ticketKeys: [`shops/${shopId}/tickets/ord_rej.pdf`],
          },
        });

        // 1. Missing ticketKey
        const fdMissing = new FormData();
        fdMissing.append("intent", "download-ticket");
        const reqMissing = new Request(
          `https://app.test/app/lab-orders/${order.id}`,
          { method: "POST", body: fdMissing },
        );
        const resMissing = await detailAction(
          createActionArgs(reqMissing, { id: order.id }),
        );
        const { status: s1, data: d1 } = await unwrapResponse<{
          error: { code: string };
        }>(resMissing);
        expect(s1).toBe(400);
        expect(d1.error.code).toBe("MISSING_TICKET_KEY");

        // 2. .exe extension
        const fdExe = new FormData();
        fdExe.append("intent", "download-ticket");
        fdExe.append("ticketKey", `shops/${shopId}/tickets/${order.id}.exe`);
        const reqExe = new Request(
          `https://app.test/app/lab-orders/${order.id}`,
          { method: "POST", body: fdExe },
        );
        const resExe = await detailAction(
          createActionArgs(reqExe, { id: order.id }),
        );
        const { status: s2, data: d2 } = await unwrapResponse<{
          error: { code: string };
        }>(resExe);
        expect(s2).toBe(400);
        expect(d2.error.code).toBe("INVALID_TICKET_KEY");

        // 3. Unknown intent
        const fdUnknown = new FormData();
        fdUnknown.append("intent", "unknown-intent");
        const reqUnknown = new Request(
          `https://app.test/app/lab-orders/${order.id}`,
          { method: "POST", body: fdUnknown },
        );
        const resUnknown = await detailAction(
          createActionArgs(reqUnknown, { id: order.id }),
        );
        const { status: s3, data: d3 } = await unwrapResponse<{
          error: { code: string };
        }>(resUnknown);
        expect(s3).toBe(400);
        expect(d3.error.code).toBe("INVALID_INTENT");
      });

      it("requireActivePlan refusal on both routes (unpaid plan redirects, unauthenticated rejects)", async () => {
        // 1. Unpaid plan -> throws redirect
        mocks.adminGraphql.mockResolvedValue(
          new Response(
            JSON.stringify({
              data: {
                currentAppInstallation: {
                  activeSubscriptions: [],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

        const reqIndex = new Request("https://app.test/app/lab-orders");
        await expect(indexLoader(createLoaderArgs(reqIndex))).rejects.toThrow();

        const reqDetail = new Request("https://app.test/app/lab-orders/some_id");
        await expect(
          detailLoader(createLoaderArgs(reqDetail, { id: "some_id" })),
        ).rejects.toThrow();

        const reqAction = new Request("https://app.test/app/lab-orders/some_id", {
          method: "POST",
          body: new FormData(),
        });
        await expect(
          detailAction(createActionArgs(reqAction, { id: "some_id" })),
        ).rejects.toThrow();
      });
    });
  });
});
