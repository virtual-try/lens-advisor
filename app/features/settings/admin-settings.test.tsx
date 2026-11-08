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
import { authenticate } from "../../shopify.server";
import type { ErrorResponseBody } from "../../shared/http/errors.server";
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

async function unwrapResponse<T = Record<string, unknown>>(
  result: unknown,
): Promise<{
  status: number;
  data: T;
}> {
  if (result instanceof Response) {
    const data = (await result.clone().json()) as T;
    return {
      status: result.status,
      data,
    };
  }
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
      const { status, data: result } = await unwrapResponse<{
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
      const { status, data: result } =
        await unwrapResponse<ErrorResponseBody>(response);

      expect(status).toBe(400);
      expect(result.error.code).toBe("EMAIL");
      expect(result.error.message).toBe("Enter a valid lab email address.");
      expect(result.error.fields).toEqual([
        { path: "labEmail.0", code: "EMAIL" },
      ]);

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
      const { status, data: result } =
        await unwrapResponse<ErrorResponseBody>(response);

      expect(status).toBe(400);
      expect(result.error.code).toBe("AT_LEAST_ONE_RX_INPUT");
      expect(result.error.message).toBe("Keep at least one prescription input on.");
      expect(result.error.fields).toEqual([
        { path: "rxUploadEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
        { path: "manualRxEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
      ]);

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
      const { status, data: result } = await unwrapResponse<{
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
      const { status, data: result } = await unwrapResponse<{
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
      const { status, data: result } = await unwrapResponse<{ ok: boolean }>(response);

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
      const { status, data: result } =
        await unwrapResponse<ErrorResponseBody>(response);

      expect(status).toBe(400);
      expect(result.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(result.error.fields).toEqual([
        { path: "storeRxInOrder", code: "CONFIRMATION_REQUIRED" },
      ]);

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.storeRxInOrder).toBe(false);
    }, DB_TIMEOUT_MS);
  });

  describe("Boundary input validation (R1-F3)", () => {
    it("rejects non-object or primitive JSON payload with 400 and writes nothing", async () => {
      const domain = "f3-primitive-json.myshopify.com";
      const shopId = await createShop(domain);
      mocks.currentShop = domain;

      // Primitive number JSON payload
      const requestNum = new Request("https://app.test/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "123",
      });
      const resNum = await action(createActionArgs(requestNum));
      const unwrappedNum = await unwrapResponse<ErrorResponseBody>(resNum);
      expect(unwrappedNum.status).toBe(400);
      expect(unwrappedNum.data.error.code).toBe("INVALID_INPUT");

      // Primitive string JSON payload
      const requestStr = new Request("https://app.test/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '"some string"',
      });
      const resStr = await action(createActionArgs(requestStr));
      const unwrappedStr = await unwrapResponse<ErrorResponseBody>(resStr);
      expect(unwrappedStr.status).toBe(400);
      expect(unwrappedStr.data.error.code).toBe("INVALID_INPUT");

      // Malformed JSON syntax
      const requestMalformed = new Request("https://app.test/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"unclosed',
      });
      const resMalformed = await action(createActionArgs(requestMalformed));
      const unwrappedMalformed =
        await unwrapResponse<ErrorResponseBody>(resMalformed);
      expect(unwrappedMalformed.status).toBe(400);
      expect(unwrappedMalformed.data.error.code).toBe("INVALID_INPUT");

      // Nothing written to database
      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual([]);
      expect(saved.storeRxInOrder).toBe(false);
    }, DB_TIMEOUT_MS);

    it("rejects invalid boolean strings in form data with 400 and writes nothing", async () => {
      const domain = "f3-form-invalid-bool.myshopify.com";
      const shopId = await createShop(domain);
      mocks.currentShop = domain;

      const formData = new FormData();
      formData.append("manualRxEnabled", "not-a-boolean");
      formData.append("labEmail", "valid@example.com");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } =
        await unwrapResponse<ErrorResponseBody>(response);

      expect(status).toBe(400);
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.fields).toEqual(
        expect.arrayContaining([
          { path: "manualRxEnabled", code: "INVALID_BOOLEAN" },
        ]),
      );

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual([]);
    }, DB_TIMEOUT_MS);

    it("rejects invalid boolean strings in JSON with 400 and writes nothing", async () => {
      const domain = "f3-json-invalid-bool.myshopify.com";
      const shopId = await createShop(domain);
      mocks.currentShop = domain;

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeRxInOrder: "invalid-string",
          labEmail: ["lab@example.com"],
        }),
      });

      const response = await action(createActionArgs(request));
      const { status, data: result } =
        await unwrapResponse<ErrorResponseBody>(response);

      expect(status).toBe(400);
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.fields).toEqual(
        expect.arrayContaining([
          { path: "storeRxInOrder", code: "INVALID_BOOLEAN" },
        ]),
      );

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual([]);
    }, DB_TIMEOUT_MS);
  });

  describe("Authorization refusal (R1-F5)", () => {
    it("loader refuses access when authenticate.admin rejects", async () => {
      const authRejectResponse = new Response(null, {
        status: 302,
        headers: { Location: "/auth/login" },
      });
      vi.mocked(authenticate.admin).mockRejectedValueOnce(authRejectResponse);

      const request = new Request("https://app.test/app/settings");
      await expect(loader(createLoaderArgs(request))).rejects.toBe(
        authRejectResponse,
      );
    }, DB_TIMEOUT_MS);

    it("action refuses access and performs no database write when authenticate.admin rejects", async () => {
      const domain = "f5-auth-refusal.myshopify.com";
      const shopId = await createShop(domain);

      const authRejectResponse = new Response(null, {
        status: 302,
        headers: { Location: "/auth/login" },
      });
      vi.mocked(authenticate.admin).mockRejectedValueOnce(authRejectResponse);

      const formData = new FormData();
      formData.append("labEmail", "attacker@example.com");

      const request = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      await expect(action(createActionArgs(request))).rejects.toBe(
        authRejectResponse,
      );

      const saved = await getSettings(shopId, getTestPrisma());
      expect(saved.labEmail).toEqual([]);
    }, DB_TIMEOUT_MS);
  });

  describe("Lab emails round-trip (R1-F6)", () => {
    it("two saved addresses render in s-text-area and round-trip unchanged", async () => {
      const shopDomain = "f6-roundtrip.myshopify.com";
      const shopId = await createShop(shopDomain);
      mocks.currentShop = shopDomain;

      // 1. Save two addresses separated by newline
      const formData = new FormData();
      formData.append("labEmail", "lab1@example.com\nlab2@example.com");

      const postRequest = new Request("https://app.test/app/settings", {
        method: "POST",
        body: formData,
      });

      const saveResponse = await action(createActionArgs(postRequest));
      const { status: saveStatus, data: saveResult } = await unwrapResponse<{
        ok: boolean;
        settings?: { labEmail: string[] };
      }>(saveResponse);

      expect(saveStatus).toBe(200);
      expect(saveResult.ok).toBe(true);
      expect(saveResult.settings?.labEmail).toEqual([
        "lab1@example.com",
        "lab2@example.com",
      ]);

      // 2. Verify stored in DB
      const savedInDb = await getSettings(shopId, getTestPrisma());
      expect(savedInDb.labEmail).toEqual([
        "lab1@example.com",
        "lab2@example.com",
      ]);

      // 3. Loader loads both addresses
      const loadRequest = new Request("https://app.test/app/settings");
      const loadResponse = await loader(createLoaderArgs(loadRequest));
      const { data: loadData } = await unwrapResponse<{
        settings: { labEmail: string[] };
      }>(loadResponse);
      expect(loadData.settings.labEmail).toEqual([
        "lab1@example.com",
        "lab2@example.com",
      ]);

      // 4. Render component and verify s-text-area value contains both lines
      vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue({
        settings: loadData.settings,
        plan: { active: true, planName: "Pro Plan", test: false },
        pricingUrl: "https://pricing.test",
      });
      vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
        data: undefined,
        state: "idle",
        Form: ({
          children,
          ...props
        }: React.PropsWithChildren<Record<string, unknown>>) => (
          <form {...props}>{children}</form>
        ),
        submit: vi.fn(),
        load: vi.fn(),
      } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

      const { container } = render(<SettingsRoute />);
      const textArea = container.querySelector(
        's-text-area[name="labEmail"]',
      );
      expect(textArea).not.toBeNull();
      expect(textArea?.getAttribute("value")).toBe(
        "lab1@example.com\nlab2@example.com",
      );
    }, DB_TIMEOUT_MS);
  });

  describe("Loader", () => {
    it("loads current settings, plan status, and pricing URL", async () => {
      const domain = "loader-test.myshopify.com";
      await createShop(domain);
      mocks.currentShop = domain;

      const request = new Request("https://app.test/app/settings");
      const response = await loader(createLoaderArgs(request));
      const { status, data: result } = await unwrapResponse<{
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

  it("renders all settings fields and plan card with change plan link (R1-F2 presence)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "idle",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const page = container.querySelector("s-page");
    expect(page).not.toBeNull();
    expect(page?.getAttribute("heading")).toBe("Settings");

    const labSection = container.querySelector(
      's-section[heading="Lab fulfillment"]',
    );
    expect(labSection).not.toBeNull();
    expect(labSection?.getAttribute("heading")).toBe("Lab fulfillment");

    const labTextArea = container.querySelector(
      's-text-area[name="labEmail"]',
    );
    expect(labTextArea).not.toBeNull();
    expect(labTextArea?.getAttribute("value")).toBe(
      "lab1@example.com\nlab2@example.com",
    );

    const rxSection = container.querySelector(
      's-section[heading="Prescription inputs"]',
    );
    expect(rxSection).not.toBeNull();
    expect(rxSection?.getAttribute("heading")).toBe("Prescription inputs");

    const privacySection = container.querySelector(
      's-section[heading="Order privacy"]',
    );
    expect(privacySection).not.toBeNull();
    expect(privacySection?.getAttribute("heading")).toBe("Order privacy");

    const planSection = container.querySelector('s-section[heading="Plan"]');
    expect(planSection).not.toBeNull();
    expect(planSection?.getAttribute("heading")).toBe("Plan");

    const planName = screen.getByText("Pro Plan");
    expect(planName).not.toBeNull();

    const changePlanLink = screen.getByText("Change plan");
    expect(changePlanLink).not.toBeNull();
    expect(changePlanLink.getAttribute("href")).toBe(
      defaultLoaderData.pricingUrl,
    );
    expect(changePlanLink.getAttribute("target")).toBe("_top");

    const helpText = screen.getByText(
      "When off, orders show 'Prescription on file' and values stay encrypted in this app.",
    );
    expect(helpText).not.toBeNull();
  });

  it("renders default (empty) settings when unconfigured (R1-F9)", () => {
    const emptyLoaderData = {
      settings: {
        labEmail: [],
        ticketFormat: "PDF" as const,
        storeRxInOrder: false,
        rxUploadEnabled: true,
        manualRxEnabled: true,
      },
      plan: {
        active: true,
        planName: "Active Plan",
        test: false,
      },
      pricingUrl: "https://pricing.test",
    };

    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(emptyLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "idle",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const textArea = container.querySelector('s-text-area[name="labEmail"]');
    expect(textArea).not.toBeNull();
    expect(textArea?.getAttribute("value")).toBe("");

    const manualRx = container.querySelector(
      's-checkbox[name="manualRxCheckbox"]',
    );
    expect(manualRx).not.toBeNull();
    expect(manualRx?.getAttribute("checked")).toBe("true");

    const rxUpload = container.querySelector(
      's-checkbox[name="rxUploadCheckbox"]',
    );
    expect(rxUpload).not.toBeNull();
    expect(rxUpload?.getAttribute("checked")).toBe("true");

    const storeRx = container.querySelector(
      's-checkbox[name="storeRxInOrderCheckbox"]',
    );
    expect(storeRx).not.toBeNull();
    expect(storeRx?.getAttribute("checked")).toBe("false");
  });

  it("renders submitting state with busy/loading save button (R1-F9)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "submitting",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    render(<SettingsRoute />);

    const saveButton = screen.getByText("Save");
    expect(saveButton).not.toBeNull();
    expect(saveButton.hasAttribute("loading")).toBe(true);
  });

  it("displays inline EMAIL error banner and field error when returned by action (R1-F4, R1-F9)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: {
        error: {
          code: "EMAIL",
          message: "Enter a valid lab email address.",
          fields: [{ path: "labEmail", code: "EMAIL" }],
        },
      },
      state: "idle",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const banner = container.querySelector(
      's-banner[heading="Invalid lab email address"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("tone")).toBe("critical");
    expect(screen.getByText("Enter a valid lab email address.")).not.toBeNull();

    const textArea = container.querySelector('s-text-area[name="labEmail"]');
    expect(textArea?.getAttribute("error")).toBe(
      "Enter a valid lab email address.",
    );
  });

  it("displays inline AT_LEAST_ONE_RX_INPUT banner inside the Prescription inputs section (R1-F7)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: {
        error: {
          code: "AT_LEAST_ONE_RX_INPUT",
          message: "Keep at least one prescription input on.",
          fields: [
            { path: "rxUploadEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
            { path: "manualRxEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
          ],
        },
      },
      state: "idle",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    // R1-F7: Banner must be inside Prescription inputs section
    const rxSection = container.querySelector(
      's-section[heading="Prescription inputs"]',
    );
    expect(rxSection).not.toBeNull();

    const banner = rxSection?.querySelector(
      's-banner[heading="Prescription inputs required"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("tone")).toBe("critical");
    expect(
      screen.getByText("Keep at least one prescription input on."),
    ).not.toBeNull();

    // Ensure it is NOT rendered as a page banner before the Lab fulfillment section
    expect(
      container.querySelector(
        'form > s-stack > s-banner[heading="Prescription inputs required"]',
      ),
    ).toBeNull();
  });

  it("triggers toast notification on success once per completed submission (R1-F8)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);

    let fetcherState = "idle";
    let fetcherData: Record<string, unknown> | undefined = undefined;

    vi.spyOn(ReactRouter, "useFetcher").mockImplementation(
      () =>
        ({
          data: fetcherData,
          state: fetcherState,
          Form: ({
            children,
            ...props
          }: React.PropsWithChildren<Record<string, unknown>>) => (
            <form {...props}>{children}</form>
          ),
          submit: vi.fn(),
          load: vi.fn(),
        }) as unknown as ReturnType<typeof ReactRouter.useFetcher>,
    );

    const { rerender } = render(<SettingsRoute />);
    expect(mocks.toastShow).not.toHaveBeenCalled();

    // First save: submitting -> idle with ok
    fetcherState = "submitting";
    rerender(<SettingsRoute />);
    expect(mocks.toastShow).not.toHaveBeenCalled();

    fetcherState = "idle";
    fetcherData = { ok: true, settings: defaultLoaderData.settings };
    rerender(<SettingsRoute />);
    expect(mocks.toastShow).toHaveBeenCalledTimes(1);
    expect(mocks.toastShow).toHaveBeenCalledWith("Settings saved");

    // Second save: submitting -> idle with ok
    fetcherState = "submitting";
    rerender(<SettingsRoute />);
    expect(mocks.toastShow).toHaveBeenCalledTimes(1);

    fetcherState = "idle";
    fetcherData = { ok: true, settings: defaultLoaderData.settings };
    rerender(<SettingsRoute />);
    expect(mocks.toastShow).toHaveBeenCalledTimes(2);
    expect(mocks.toastShow).toHaveBeenLastCalledWith("Settings saved");
  });

  it("privacy flow driven through toggle: toggle opens modal, cancel reverts toggle, confirm enables and submits (R1-F1, R1-F2)", () => {
    vi.spyOn(ReactRouter, "useLoaderData").mockReturnValue(defaultLoaderData);
    vi.spyOn(ReactRouter, "useFetcher").mockReturnValue({
      data: undefined,
      state: "idle",
      Form: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => (
        <form {...props}>{children}</form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    } as unknown as ReturnType<typeof ReactRouter.useFetcher>);

    const { container } = render(<SettingsRoute />);

    const confirmModal = container.querySelector("#privacy-confirm-modal");
    expect(confirmModal).not.toBeNull();
    // Modal starts closed
    expect(confirmModal?.hasAttribute("open")).toBe(false);

    const hiddenStoreInput = container.querySelector(
      'input[name="storeRxInOrder"]',
    ) as HTMLInputElement | null;
    const hiddenConfirmInput = container.querySelector(
      'input[name="confirmStoreRxInOrder"]',
    ) as HTMLInputElement | null;
    expect(hiddenStoreInput).not.toBeNull();
    expect(hiddenConfirmInput).not.toBeNull();
    expect(hiddenStoreInput?.value).toBe("false");
    expect(hiddenConfirmInput?.value).toBe("false");

    const toggle = container.querySelector(
      's-checkbox[name="storeRxInOrderCheckbox"]',
    );
    expect(toggle).not.toBeNull();

    // 1. User changes the checkbox to true -> modal MUST open
    fireEvent.input(toggle!, {
      target: { checked: true },
      currentTarget: { checked: true },
    });
    expect(confirmModal?.hasAttribute("open")).toBe(true);

    // 2. User clicks Cancel in the modal -> modal closes, toggle stays off, nothing confirmed
    const cancelBtn = screen.getByText("Cancel");
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);

    expect(confirmModal?.hasAttribute("open")).toBe(false);
    expect(hiddenStoreInput?.value).toBe("false");
    expect(hiddenConfirmInput?.value).toBe("false");

    // 3. User changes the checkbox to true again -> modal opens
    fireEvent.input(toggle!, {
      target: { checked: true },
      currentTarget: { checked: true },
    });
    expect(confirmModal?.hasAttribute("open")).toBe(true);

    // 4. User clicks Confirm in the modal -> modal closes, toggle is on, confirm field is set
    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).not.toBeNull();
    fireEvent.click(confirmBtn);

    expect(confirmModal?.hasAttribute("open")).toBe(false);
    expect(hiddenStoreInput?.value).toBe("true");
    expect(hiddenConfirmInput?.value).toBe("true");
  });
});
