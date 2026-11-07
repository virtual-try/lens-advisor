import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/http/errors.server";
import {
  buildPricingPlansUrl,
  getPlanStatus,
  PLAN_STATUS_QUERY,
  type PlanAdminClient,
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

function adminReturning(payload: unknown, init?: ResponseInit) {
  const graphql = vi.fn(async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), init)
  );

  return { admin: { graphql } as unknown as PlanAdminClient, graphql };
}

function adminThatFails() {
  const graphql = vi.fn(async () => {
    throw new Error("socket hang up");
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

describe("getPlanStatus", () => {
  it("returns the active plan name for one ACTIVE subscription", async () => {
    const { admin, graphql } = adminReturning({
      data: {
        currentAppInstallation: {
          activeSubscriptions: [subscription("Pro", "ACTIVE")],
        },
      },
    });

    await expect(getPlanStatus(admin)).resolves.toEqual({
      active: true,
      planName: "Pro",
      test: false,
    });

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledWith(PLAN_STATUS_QUERY);
    expect(PLAN_STATUS_QUERY).toContain("currentAppInstallation");
    expect(PLAN_STATUS_QUERY).toContain("activeSubscriptions");
    expect(PLAN_STATUS_QUERY).toContain("status");
    expect(PLAN_STATUS_QUERY).toContain("test");
  });

  it("reports inactive when the shop has no subscriptions", async () => {
    const { admin } = adminReturning({
      data: { currentAppInstallation: { activeSubscriptions: [] } },
    });

    const plan = await getPlanStatus(admin);

    expect(plan).toEqual({ active: false, test: false });
    expect(plan.planName).toBeUndefined();
  });

  it("ignores a CANCELLED subscription and returns the ACTIVE one's name", async () => {
    const { admin } = adminReturning({
      data: {
        currentAppInstallation: {
          activeSubscriptions: [
            subscription("Legacy", "CANCELLED", false, "gid://shopify/AppSubscription/1"),
            subscription("Pro", "ACTIVE", false, "gid://shopify/AppSubscription/2"),
          ],
        },
      },
    });

    await expect(getPlanStatus(admin)).resolves.toEqual({
      active: true,
      planName: "Pro",
      test: false,
    });
  });

  it("reports a test subscription on a dev store as active and test", async () => {
    const { admin } = adminReturning({
      data: {
        currentAppInstallation: {
          activeSubscriptions: [subscription("Pro", "ACTIVE", true)],
        },
      },
    });

    await expect(getPlanStatus(admin)).resolves.toEqual({
      active: true,
      planName: "Pro",
      test: true,
    });
  });

  it("throws AppError 502 BILLING_UNAVAILABLE on a GraphQL error", async () => {
    const { admin } = adminReturning({
      data: null,
      errors: [{ message: "Internal error while fetching subscriptions" }],
    });

    const error = await expectBillingUnavailable(getPlanStatus(admin));
    expect(error.message).not.toContain("Internal error while fetching subscriptions");
  });

  it("throws AppError 502 on a non-OK HTTP response", async () => {
    const { admin } = adminReturning({}, { status: 500 });
    await expectBillingUnavailable(getPlanStatus(admin));
  });

  it("throws AppError 502 when the network request fails", async () => {
    const { admin } = adminThatFails();
    await expectBillingUnavailable(getPlanStatus(admin));
  });

  it("throws AppError 502 on a malformed JSON body", async () => {
    const { admin } = adminReturning("{not json");
    await expectBillingUnavailable(getPlanStatus(admin));
  });

  it("throws AppError 502 when the response does not match the expected schema", async () => {
    const { admin } = adminReturning({
      data: { currentAppInstallation: { activeSubscriptions: [{ id: "1" }] } },
    });

    await expectBillingUnavailable(getPlanStatus(admin));
  });

  it("throws AppError 502 when currentAppInstallation is missing", async () => {
    const { admin } = adminReturning({ data: {} });
    await expectBillingUnavailable(getPlanStatus(admin));
  });

  it("does not cache between calls", async () => {
    const { admin, graphql } = adminReturning({
      data: {
        currentAppInstallation: {
          activeSubscriptions: [subscription("Pro", "ACTIVE")],
        },
      },
    });

    await getPlanStatus(admin);
    await getPlanStatus(admin);

    expect(graphql).toHaveBeenCalledTimes(2);
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
