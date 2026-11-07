import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/http/errors.server";
import type { PlanAdminClient } from "./plan.server";
import { requireActivePlan } from "./require-plan.server";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("../../shared/config.server", () => ({
  getConfig: mocks.getConfig,
}));

const PRICING_URL =
  "https://admin.shopify.com/store/cool-shop/charges/lens-advisor/pricing_plans";

function adminReturning(payload: unknown): PlanAdminClient {
  return {
    graphql: vi.fn(
      async () => new Response(JSON.stringify(payload), { status: 200 })
    ),
  } as unknown as PlanAdminClient;
}

function adminThatFails(): PlanAdminClient {
  return {
    graphql: vi.fn(async () => {
      throw new Error("socket hang up");
    }),
  } as unknown as PlanAdminClient;
}

function buildContext(admin: PlanAdminClient) {
  const redirect = vi.fn((url: string) => {
    return new Response(null, {
      status: 302,
      headers: { location: url },
    });
  });

  return {
    context: {
      admin,
      session: { shop: "cool-shop.myshopify.com" },
      redirect,
    },
    redirect,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockReturnValue({ billing: { appHandle: "lens-advisor" } });
});

describe("requireActivePlan", () => {
  it("returns the admin context with the plan when a plan is active", async () => {
    const admin = adminReturning({
      data: {
        currentAppInstallation: {
          activeSubscriptions: [{ id: "1", name: "Pro", status: "ACTIVE", test: false }],
        },
      },
    });
    const { context, redirect } = buildContext(admin);
    mocks.authenticateAdmin.mockResolvedValue(context);

    const result = await requireActivePlan(new Request("https://app.test/app"));

    expect(result.plan).toEqual({ active: true, planName: "Pro", test: false });
    expect(result.admin).toBe(admin);
    expect(result.session.shop).toBe("cool-shop.myshopify.com");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects a shop with no plan to the hosted pricing page in the top frame", async () => {
    const admin = adminReturning({
      data: { currentAppInstallation: { activeSubscriptions: [] } },
    });
    const { context, redirect } = buildContext(admin);
    mocks.authenticateAdmin.mockResolvedValue(context);

    const error = await captureError(requireActivePlan(new Request("https://app.test/app")));

    expect(error).toBeInstanceOf(Response);
    const response = error as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(PRICING_URL);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(PRICING_URL, { target: "_top" });
  });

  it("never redirects when the GraphQL lookup fails", async () => {
    const admin = adminThatFails();
    const { context, redirect } = buildContext(admin);
    mocks.authenticateAdmin.mockResolvedValue(context);

    const error = await captureError(requireActivePlan(new Request("https://app.test/app")));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(502);
    expect((error as AppError).code).toBe("BILLING_UNAVAILABLE");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("builds the store handle from the session, not from request query parameters", async () => {
    const admin = adminReturning({
      data: { currentAppInstallation: { activeSubscriptions: [] } },
    });
    const { context, redirect } = buildContext(admin);
    mocks.authenticateAdmin.mockResolvedValue(context);

    await captureError(
      requireActivePlan(new Request("https://app.test/app?shop=evil.myshopify.com"))
    );

    expect(redirect).toHaveBeenCalledWith(PRICING_URL, { target: "_top" });
    expect(PRICING_URL).toContain("store/cool-shop/");
    expect(PRICING_URL).not.toContain("evil");
  });

  it("propagates an authentication failure without checking billing or redirecting", async () => {
    const admin = adminReturning({});
    const { redirect } = buildContext(admin);
    const authFailure = new Response(null, {
      status: 302,
      headers: { location: "/auth/login" },
    });
    mocks.authenticateAdmin.mockRejectedValue(authFailure);

    const error = await captureError(requireActivePlan(new Request("https://app.test/app")));

    expect(error).toBe(authFailure);
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
