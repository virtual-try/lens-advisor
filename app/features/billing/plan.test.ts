import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { resetConfigCache } from "../../shared/config.server";
import { AppError } from "../../shared/http/errors.server";
import {
  ADMIN_PLAN_STATUS_QUERY,
  buildPricingPlansUrl,
  getPlanStatus,
  PARTNER_API_VERSION,
  PARTNER_SUBSCRIPTION_QUERY,
  type PlanAdminClient,
  PLAN_STATUS_QUERY,
  SHOP_ID_QUERY,
} from "./plan.server";

interface SubscriptionFixture {
  id: string;
  name: string;
  status: string;
  test: boolean;
}

function subscription(
  name: string,
  status: string,
  test = false,
  id = `gid://shopify/AppSubscription/${name.toLowerCase()}`
): SubscriptionFixture {
  return { id, name, status, test };
}

interface AdminMockOptions {
  shopId?: string;
  shopResponse?: {
    status?: number;
    body?: unknown;
    error?: Error;
  };
  adminSubscriptions?: SubscriptionFixture[];
  adminResponse?: {
    status?: number;
    body?: unknown;
    error?: Error;
  };
}

function createAdminClient(options: AdminMockOptions = {}) {
  const shopId = options.shopId ?? "gid://shopify/Shop/12345";
  const graphql = vi.fn(async (query: string) => {
    if (typeof query === "string" && query.includes("AppPlanShopId")) {
      if (options.shopResponse?.error) {
        throw options.shopResponse.error;
      }
      if (options.shopResponse) {
        const status = options.shopResponse.status ?? 200;
        const body =
          typeof options.shopResponse.body === "string"
            ? options.shopResponse.body
            : JSON.stringify(options.shopResponse.body ?? {});
        return new Response(body, { status });
      }
      return new Response(JSON.stringify({ data: { shop: { id: shopId } } }), { status: 200 });
    }

    if (typeof query === "string" && query.includes("AppPlanStatus")) {
      if (options.adminResponse?.error) {
        throw options.adminResponse.error;
      }
      if (options.adminResponse) {
        const status = options.adminResponse.status ?? 200;
        const body =
          typeof options.adminResponse.body === "string"
            ? options.adminResponse.body
            : JSON.stringify(options.adminResponse.body ?? {});
        return new Response(body, { status });
      }
      return new Response(
        JSON.stringify({
          data: {
            currentAppInstallation: {
              activeSubscriptions: options.adminSubscriptions ?? [],
            },
          },
        }),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected GraphQL query: ${query}`);
  });

  return { admin: { graphql } as unknown as PlanAdminClient, graphql };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

async function expectBillingUnavailable(promise: Promise<unknown>): Promise<AppError> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(AppError);

  const appError = error as AppError;
  expect(appError.status).toBe(502);
  expect(appError.code).toBe("BILLING_UNAVAILABLE");
  return appError;
}

const TEST_ORG_ID = "org-test-999";
const TEST_ACCESS_TOKEN = "shppa_test_secret_token";
const TEST_APP_GID = "gid://shopify/App/88888";

describe("getPlanStatus", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
    vi.stubEnv("PARTNER_ORGANIZATION_ID", TEST_ORG_ID);
    vi.stubEnv("PARTNER_API_ACCESS_TOKEN", TEST_ACCESS_TOKEN);
    vi.stubEnv("SHOPIFY_APP_GID", TEST_APP_GID);

    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
    fetchSpy.mockRestore();
  });

  it("returns active plan from the Partner API activeSubscription", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              items: [{ handle: "pro-annual", description: "Pro" }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { admin, graphql } = createAdminClient();
    const req = new Request("https://app.test");

    const plan = await getPlanStatus(req, admin);

    expect(plan).toEqual({
      active: true,
      planName: "Pro",
      test: false,
    });

    // Fetched shop ID from Admin API
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledWith(SHOP_ID_QUERY);

    // Queried Partner API with canonical credentials and variables
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [fetchUrl, rawInit] = fetchSpy.mock.calls[0];
    const fetchInit = rawInit as RequestInit;
    expect(fetchUrl).toBe(
      `https://partners.shopify.com/${TEST_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`
    );
    expect((fetchInit?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(
      TEST_ACCESS_TOKEN
    );
    const requestBody = JSON.parse(fetchInit?.body as string);
    expect(requestBody.query).toBe(PARTNER_SUBSCRIPTION_QUERY);
    expect(requestBody.variables).toEqual({
      appId: TEST_APP_GID,
      shopId: "gid://shopify/Shop/12345",
    });
  });

  it("uses the plan handle when item description is nullish in Partner API", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              items: [{ handle: "growth-monthly", description: null }],
            },
          },
        }),
        { status: 200 }
      )
    );

    const { admin } = createAdminClient();
    const plan = await getPlanStatus(new Request("https://app.test"), admin);

    expect(plan).toEqual({
      active: true,
      planName: "growth-monthly",
      test: false,
    });
  });

  it("falls back to Admin API currentAppInstallation when Partner API activeSubscription is null", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin, graphql } = createAdminClient({
      adminSubscriptions: [subscription("Pro", "ACTIVE")],
    });

    const plan = await getPlanStatus(new Request("https://app.test"), admin);

    expect(plan).toEqual({
      active: true,
      planName: "Pro",
      test: false,
    });

    // 1 call for shop ID, 1 call for fallback subscriptions
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenNthCalledWith(1, SHOP_ID_QUERY);
    expect(graphql).toHaveBeenNthCalledWith(2, ADMIN_PLAN_STATUS_QUERY);
    expect(ADMIN_PLAN_STATUS_QUERY).toBe(PLAN_STATUS_QUERY);
  });

  it("reports inactive only when both Partner API and Admin API subscriptions are empty", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin } = createAdminClient({ adminSubscriptions: [] });
    const plan = await getPlanStatus(new Request("https://app.test"), admin);

    expect(plan).toEqual({ active: false, test: false });
    expect(plan.planName).toBeUndefined();
  });

  it("ignores a CANCELLED subscription and returns the ACTIVE one in fallback", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin } = createAdminClient({
      adminSubscriptions: [
        subscription("Legacy", "CANCELLED", false, "gid://shopify/AppSubscription/1"),
        subscription("Pro", "ACTIVE", false, "gid://shopify/AppSubscription/2"),
      ],
    });

    const plan = await getPlanStatus(new Request("https://app.test"), admin);
    expect(plan).toEqual({
      active: true,
      planName: "Pro",
      test: false,
    });
  });

  it("reports a test subscription on a dev store as active and test in fallback", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin } = createAdminClient({
      adminSubscriptions: [subscription("Pro", "ACTIVE", true)],
    });

    const plan = await getPlanStatus(new Request("https://app.test"), admin);
    expect(plan).toEqual({
      active: true,
      planName: "Pro",
      test: true,
    });
  });

  it("throws AppError 502 BILLING_UNAVAILABLE on Partner API GraphQL errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "Unauthorized partner access" }],
        }),
        { status: 200 }
      )
    );

    const { admin } = createAdminClient();
    const error = await expectBillingUnavailable(
      getPlanStatus(new Request("https://app.test"), admin)
    );
    expect(error.message).not.toContain("Unauthorized partner access");
  });

  it("throws AppError 502 on Partner API non-OK HTTP status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    const { admin } = createAdminClient();
    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 when Partner API network request fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Connection reset by peer"));

    const { admin } = createAdminClient();
    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 on Partner API malformed JSON", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{bad-json", { status: 200 }));

    const { admin } = createAdminClient();
    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 on Partner API unexpected response schema", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { unexpected: true } }), { status: 200 })
    );

    const { admin } = createAdminClient();
    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 when Partner credentials are missing", async () => {
    vi.stubEnv("PARTNER_API_ACCESS_TOKEN", "");
    resetConfigCache();

    const { admin } = createAdminClient();
    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 on Admin API shopId GraphQL error", async () => {
    const { admin } = createAdminClient({
      shopResponse: {
        body: { errors: [{ message: "Shop access denied" }] },
      },
    });

    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 when Admin API network request fails", async () => {
    const { admin } = createAdminClient({
      shopResponse: { error: new Error("socket hang up") },
    });

    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 on Admin API non-OK HTTP response", async () => {
    const { admin } = createAdminClient({
      shopResponse: { status: 503 },
    });

    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("throws AppError 502 on Admin API fallback error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin } = createAdminClient({
      adminResponse: {
        body: { errors: [{ message: "Failed to fetch active subscriptions" }] },
      },
    });

    await expectBillingUnavailable(getPlanStatus(new Request("https://app.test"), admin));
  });

  it("memoizes within one request and re-queries on the next request", async () => {
    // Request 1: Partner API returns "Pro"
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              items: [{ handle: "pro", description: "Pro" }],
            },
          },
        }),
        { status: 200 }
      )
    );

    const { admin, graphql } = createAdminClient();
    const req1 = new Request("https://app.test/request-1");

    const firstLookup = await getPlanStatus(req1, admin);
    const secondLookup = await getPlanStatus(req1, admin);

    expect(firstLookup).toEqual({ active: true, planName: "Pro", test: false });
    expect(secondLookup).toBe(firstLookup);

    // Only 1 upstream GraphQL and 1 Partner fetch during request 1
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Request 2: Partner API now returns null, shop falls back to Admin "Enterprise"
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 })
    );

    const { admin: admin2, graphql: graphql2 } = createAdminClient({
      adminSubscriptions: [subscription("Enterprise", "ACTIVE")],
    });
    const req2 = new Request("https://app.test/request-2");

    const thirdLookup = await getPlanStatus(req2, admin2);

    expect(thirdLookup).toEqual({ active: true, planName: "Enterprise", test: false });
    // Re-queried on next request boundary: 2 admin calls (shopId + fallback) and 1 partner fetch
    expect(graphql2).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("buildPricingPlansUrl", () => {
  it("builds the hosted plan-selection URL from the shop domain and app handle", () => {
    expect(buildPricingPlansUrl("cool-shop.myshopify.com", "lens-advisor")).toBe(
      "https://admin.shopify.com/store/cool-shop/charges/lens-advisor/pricing_plans"
    );
  });

  it("strips the myshopify domain suffix regardless of case", () => {
    expect(buildPricingPlansUrl("Cool-Shop.MyShopify.com", "lens-advisor")).toBe(
      "https://admin.shopify.com/store/Cool-Shop/charges/lens-advisor/pricing_plans"
    );
  });

  it("rejects an empty app handle instead of building a broken URL", () => {
    expect(() => buildPricingPlansUrl("cool-shop.myshopify.com", "  ")).toThrow(AppError);
  });
});
