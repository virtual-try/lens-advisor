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
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as ReactRouter from "react-router";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";

import { createTestDb, type TestDb } from "../../../test/db";
import { getSettings } from "./settings.service.server";
import SettingsRoute, { action, loader } from "../../routes/app.settings";

const DB_TIMEOUT_MS = 120_000;

const mocks = vi.hoisted(() => ({
  currentShop: "test-shop.myshopify.com",
  toastShow: vi.fn(),
  redirect: vi.fn(),
  adminGraphql: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: mocks.currentShop },
      admin: {
        graphql: mocks.adminGraphql,
      },
      redirect: mocks.redirect,
    })),
  },
}));

vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({
    toast: { show: mocks.toastShow },
  }),
}));

let db: TestDb | undefined;

function getTestPrisma() {
  if (!db) throw new Error("Test database not initialized");
  return db.prisma;
}

beforeAll(async () => {
  db = await createTestDb();
  (globalThis as Record<string, unknown>).__prismaClient = db.prisma;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  (globalThis as Record<string, unknown>).__prismaClient = undefined;
  await db?.drop();
}, DB_TIMEOUT_MS);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure testConfig is exercised in the test harness
  testConfig();

  vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
    if (query.includes("AppPlanShopId")) {
      return new Response(
        JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1001" } } }),
        { status: 200 },
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
      { status: 200 },
    );
  });
});

async function createShop(domain: string): Promise<string> {
  const shop = await getTestPrisma().shop.create({
    data: { domain },
  });
  return shop.id;
}

function createActionArgs(request: Request): ReactRouter.ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: {},
    url,
    pattern: { path: "/app/settings" },
  } as unknown as ReactRouter.ActionFunctionArgs;
}

function createLoaderArgs(request: Request): ReactRouter.LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: {},
    url,
    pattern: { path: "/app/settings" },
  } as unknown as ReactRouter.LoaderFunctionArgs;
}

function unwrapResponse<T = Record<string, unknown>>(result: unknown): {
  status: number;
  data: T;
} {
  if (
    result &&
    typeof result === "object" &&
    "type" in result &&
    (result as { type: string }).type === "DataWithResponseInit"
  ) {
    const r = result as unknown as {
      data: T;
      init?: { status?: number };
    };
    return {
      status: r.init?.status ?? 200,
      data: r.data,
    };
  }
  if (result instanceof Response) {
    throw new Error("Unexpected bare Response");
  }
  return {
    status: 200,
    data: result as T,
  };
}

describe("Spec 20 — Admin Settings Route (Server)", () => {
  describe("Examples", () => {
    it("add lab@example.com, save -> saved, toast (normal)", async () => {
      const shopDomain = "example-row1.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const formData = new FormData();
      formData.append("labEmail", "lab@example.com");
      formData.append("ticketFormat", "PDF");
      formData.append("manualRxEnabled", "true");
      formData.append("rxUploadEnabled", "true");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        settings?: { labEmail: string[] };
      }>(response);

      expect(status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.settings?.labEmail).toEqual(["lab@example.com"]);

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual(["lab@example.com"]);
    }, DB_TIMEOUT_MS);

    it("lab@ -> inline EMAIL error, nothing saved (invalid)", async () => {
      const shopDomain = "example-row2.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const formData = new FormData();
      formData.append("labEmail", "lab@");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        code?: string;
        errors?: Record<string, string>;
      }>(response);

      expect(status).toBe(400);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("EMAIL");
      expect(result.errors?.labEmail).toBe("EMAIL");

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual([]);
    }, DB_TIMEOUT_MS);

    it("both Rx inputs unchecked -> inline AT_LEAST_ONE_RX_INPUT (invalid)", async () => {
      const shopDomain = "example-row3.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const formData = new FormData();
      formData.append("manualRxEnabled", "false");
      formData.append("rxUploadEnabled", "false");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        code?: string;
        errors?: Record<string, string>;
      }>(response);

      expect(status).toBe(400);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("AT_LEAST_ONE_RX_INPUT");
      expect(result.errors?.manualRxEnabled).toBe("AT_LEAST_ONE_RX_INPUT");
      expect(result.errors?.rxUploadEnabled).toBe("AT_LEAST_ONE_RX_INPUT");

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.manualRxEnabled).toBe(true);
      expect(saved.rxUploadEnabled).toBe(true);
    }, DB_TIMEOUT_MS);

    it("privacy toggle on, confirm -> saved true (INV-3)", async () => {
      const shopDomain = "example-row4.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      const formData = new FormData();
      formData.append("storeRxInOrder", "true");
      formData.append("confirmStoreRxInOrder", "true");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        settings?: { storeRxInOrder: boolean };
      }>(response);

      expect(status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.settings?.storeRxInOrder).toBe(true);

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.storeRxInOrder).toBe(true);
    }, DB_TIMEOUT_MS);

    it("privacy toggle on, cancel -> stays false (INV-3)", async () => {
      const shopDomain = "example-row5.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      // When cancelled in the UI, the toggle reverts to false and confirms nothing
      const formData = new FormData();
      formData.append("storeRxInOrder", "false");
      formData.append("confirmStoreRxInOrder", "false");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        settings?: { storeRxInOrder: boolean };
      }>(response);

      expect(status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.settings?.storeRxInOrder).toBe(false);

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.storeRxInOrder).toBe(false);
    }, DB_TIMEOUT_MS);
  });

  describe("Invariants", () => {
    it("INV-1: action ignores any shopId in form data and writes session shop only", async () => {
      const domainA = "inv1-shop-a.myshopify.com";
      const domainB = "inv1-shop-b.myshopify.com";
      const shopAId = await createShop(domainA);
      const shopBId = await createShop(domainB);

      mocks.currentShop = domainA;

      const formData = new FormData();
      formData.append("shopId", shopBId);
      formData.append("labEmail", "alpha@example.com");
      formData.append("ticketFormat", "CSV");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{ ok: boolean }>(response);

      expect(status).toBe(200);
      expect(result.ok).toBe(true);

      const settingsA = await getSettings(shopAId, getTestPrisma());
      expect(settingsA.labEmail).toEqual(["alpha@example.com"]);
      expect(settingsA.ticketFormat).toBe("CSV");

      const settingsB = await getSettings(shopBId, getTestPrisma());
      expect(settingsB.labEmail).toEqual([]);
      expect(settingsB.ticketFormat).toBe("PDF");
    }, DB_TIMEOUT_MS);

    it("INV-3: post setting storeRxInOrder=true without confirmation field is rejected", async () => {
      const domain = "inv3-reject.myshopify.com";
      const shopId = await createShop(domain);
      mocks.currentShop = domain;

      const formData = new FormData();
      formData.append("storeRxInOrder", "true");
      // Intentionally omit confirmation field

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } = unwrapResponse<{
        ok: boolean;
        code?: string;
        errors?: Record<string, string>;
      }>(response);

      expect(status).toBe(400);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("CONFIRMATION_REQUIRED");
      expect(result.errors?.storeRxInOrder).toBe("CONFIRMATION_REQUIRED");

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.storeRxInOrder).toBe(false);
    }, DB_TIMEOUT_MS);
  });

  describe("Loader", () => {
    it("loads current settings, plan status, and pricing URL", async () => {
      const domain = "loader-test.myshopify.com";
      await createShop(domain);
      mocks.currentShop = domain;

      const request = new Request("https://app.test/app/settings");
      const response = await loader(createLoaderArgs(request));
      const { status, data: result } = unwrapResponse<{
        settings: { ticketFormat: string; storeRxInOrder: boolean };
        plan: { active: boolean; planName?: string };
        pricingUrl: string;
      }>(response);

      expect(status).toBe(200);
      expect(result.settings.ticketFormat).toBe("PDF");
      expect(result.settings.storeRxInOrder).toBe(false);
      expect(result.plan.active).toBe(true);
      expect(result.plan.planName).toBe("Pro Plan");
      expect(result.pricingUrl).toContain("pricing_plans");
    }, DB_TIMEOUT_MS);
  });
});

describe("Spec 20 — Admin Settings Component (UI)", () => {
  const defaultLoaderData = {
    settings: {
      labEmail: ["lab1@example.com", "lab2@example.com"],
      ticketFormat: "PDF" as const,
      storeRxInOrder: false,
      rxUploadEnabled: true,
      manualRxEnabled: true,
    },
    plan: {
      active: true,
      planName: "Pro Plan",
      test: false,
    },
    pricingUrl:
      "https://admin.shopify.com/store/test-shop/charges/lens-advisor/pricing_plans",
  };

  it("renders all settings fields and plan card with change plan link", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "idle",
      Form: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const page = container.querySelector("s-page");
    expect(page?.getAttribute("heading")).toBe("Settings");

    const labSection = container.querySelector('s-section[heading="Lab fulfillment"]');
    expect(labSection).toBeDefined();

    const rxSection = container.querySelector('s-section[heading="Prescription inputs"]');
    expect(rxSection).toBeDefined();

    const privacySection = container.querySelector('s-section[heading="Order privacy"]');
    expect(privacySection).toBeDefined();

    const planSection = container.querySelector('s-section[heading="Plan"]');
    expect(planSection).toBeDefined();

    expect(screen.getByText("Pro Plan")).toBeDefined();

    const changePlanLink = screen.getByText("Change plan");
    expect(changePlanLink.getAttribute("href")).toBe(defaultLoaderData.pricingUrl);
    expect(changePlanLink.getAttribute("target")).toBe("_top");

    expect(
      screen.getByText(
        "When off, orders show 'Prescription on file' and values stay encrypted in this app.",
      ),
    ).toBeDefined();
  });

  it("displays inline EMAIL error banner and field error when returned by action", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: {
        ok: false,
        code: "EMAIL",
        errors: { labEmail: "EMAIL" },
      },
      state: "idle",
      Form: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const banner = container.querySelector(
      's-banner[heading="Invalid lab email address"]',
    );
    expect(banner).toBeDefined();
    expect(screen.getByText("Enter a valid lab email address.")).toBeDefined();
  });

  it("displays inline AT_LEAST_ONE_RX_INPUT banner when returned by action", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: {
        ok: false,
        code: "AT_LEAST_ONE_RX_INPUT",
        errors: {
          rxUploadEnabled: "AT_LEAST_ONE_RX_INPUT",
          manualRxEnabled: "AT_LEAST_ONE_RX_INPUT",
        },
      },
      state: "idle",
      Form: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const banner = container.querySelector(
      's-banner[heading="Prescription inputs required"]',
    );
    expect(banner).toBeDefined();
    expect(screen.getByText("Keep at least one prescription input on.")).toBeDefined();
  });

  it("triggers toast notification on success", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: { ok: true },
      state: "idle",
      Form: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    render(<SettingsRoute />);
    expect(mocks.toastShow).toHaveBeenCalledWith("Settings saved");
  });

  it("confirming privacy modal confirms setting; cancelling resets it", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "idle",
      Form: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const confirmModal = container.querySelector("#privacy-confirm-modal");
    expect(confirmModal).toBeDefined();

    // Confirm button click
    const confirmBtn = screen.getByText("Confirm");
    fireEvent.click(confirmBtn);

    const hiddenConfirmInput = container.querySelector(
      'input[name="confirmStoreRxInOrder"]',
    ) as HTMLInputElement | null;
    const hiddenStoreInput = container.querySelector(
      'input[name="storeRxInOrder"]',
    ) as HTMLInputElement | null;
    expect(hiddenConfirmInput?.value).toBe("true");
    expect(hiddenStoreInput?.value).toBe("true");

    // Cancel button click
    const cancelBtn = screen.getByText("Cancel");
    fireEvent.click(cancelBtn);

    expect(hiddenConfirmInput?.value).toBe("false");
    expect(hiddenStoreInput?.value).toBe("false");
  });
});
