import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

import { getBillingConfig } from "../../shared/config.server";
import { AppError } from "../../shared/http/errors.server";

/**
 * The subset of the authenticated admin client the plan check needs. Keeping it
 * narrow lets unit tests pass a fake client without building a full auth context.
 */
export type PlanAdminClient = Pick<AdminApiContext, "graphql">;

export interface PlanStatus {
  active: boolean;
  planName?: string;
  test: boolean;
}

/** Matches the app's Admin API version (`ApiVersion.October26`). */
export const PARTNER_API_VERSION = "2026-10";

/**
 * The Partner API needs the numeric shop GID, which is not in the session.
 * Fetch it from the Admin API; the same call also gives us the legacy fallback
 * subscriptions below.
 */
export const SHOP_ID_QUERY = `#graphql
  query AppPlanShopId {
    shop {
      id
    }
  }
`;

/**
 * Legacy Billing API fallback. Shopify App Pricing subscriptions are canonical
 * through the Partner API, but a shop migrated from the Billing API may still
 * be active only here. It is consulted only when the Partner API returns null.
 */
export const ADMIN_PLAN_STATUS_QUERY = `#graphql
  query AppPlanStatus {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
      }
    }
  }
`;

/** Backward-compatible alias for ADMIN_PLAN_STATUS_QUERY. */
export const PLAN_STATUS_QUERY = ADMIN_PLAN_STATUS_QUERY;

/**
 * Canonical Shopify App Pricing lookup. `activeSubscription` returns null when
 * the shop has no active subscription through Shopify App Pricing or the
 * Billing API.
 */
export const PARTNER_SUBSCRIPTION_QUERY = `#graphql
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      items {
        handle
        description
      }
    }
  }
`;

const graphQLErrorsSchema = z.array(z.object({ message: z.string() })).optional();

const appSubscriptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  test: z.boolean(),
});

const shopIdResponseSchema = z.object({
  data: z.object({
    shop: z.object({
      id: z.string().min(1),
    }),
  }),
  errors: graphQLErrorsSchema,
});

const adminPlanResponseSchema = z.object({
  data: z.object({
    currentAppInstallation: z.object({
      activeSubscriptions: z.array(appSubscriptionSchema),
    }),
  }),
  errors: graphQLErrorsSchema,
});

const partnerSubscriptionSchema = z.object({
  items: z.array(
    z.object({
      handle: z.string().min(1).nullish(),
      description: z.string().min(1).nullish(),
    })
  ),
});

const partnerResponseSchema = z.object({
  data: z.object({
    activeSubscription: partnerSubscriptionSchema.nullable(),
  }),
  errors: graphQLErrorsSchema,
});

function billingUnavailable(): AppError {
  return new AppError(
    502,
    "BILLING_UNAVAILABLE",
    "Unable to verify the app subscription with Shopify. Please try again shortly."
  );
}

function hasGraphQLErrors(body: { errors?: { message: string }[] }): boolean {
  return (body.errors?.length ?? 0) > 0;
}

async function adminGraphql(admin: PlanAdminClient, query: string): Promise<unknown> {
  let body: unknown;

  try {
    const response = await admin.graphql(query);

    if (!response.ok) {
      throw billingUnavailable();
    }

    body = await response.json();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw billingUnavailable();
  }

  return body;
}

async function getShopId(admin: PlanAdminClient): Promise<string> {
  const body = await adminGraphql(admin, SHOP_ID_QUERY);
  const parsed = shopIdResponseSchema.safeParse(body);

  if (!parsed.success || hasGraphQLErrors(parsed.data)) {
    throw billingUnavailable();
  }

  return parsed.data.data.shop.id;
}

async function getAdminFallbackPlan(admin: PlanAdminClient): Promise<PlanStatus | undefined> {
  const body = await adminGraphql(admin, ADMIN_PLAN_STATUS_QUERY);
  const parsed = adminPlanResponseSchema.safeParse(body);

  if (!parsed.success || hasGraphQLErrors(parsed.data)) {
    throw billingUnavailable();
  }

  const activeSubscription = parsed.data.data.currentAppInstallation.activeSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE"
  );

  if (!activeSubscription) {
    return undefined;
  }

  return {
    active: true,
    planName: activeSubscription.name,
    test: activeSubscription.test,
  };
}

async function getPartnerPlan(shopId: string): Promise<PlanStatus | undefined> {
  let partnerOrganizationId: string;
  let partnerAccessToken: string;
  let appGid: string;

  try {
    const config = getBillingConfig();
    partnerOrganizationId = config.partnerOrganizationId;
    partnerAccessToken = config.partnerAccessToken;
    appGid = config.appGid;
  } catch {
    // A missing Partner credential is a billing outage, not proof of no plan.
    throw billingUnavailable();
  }

  const url = `https://partners.shopify.com/${encodeURIComponent(
    partnerOrganizationId
  )}/api/${PARTNER_API_VERSION}/graphql.json`;

  let body: unknown;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": partnerAccessToken,
      },
      body: JSON.stringify({
        query: PARTNER_SUBSCRIPTION_QUERY,
        variables: {
          appId: appGid,
          shopId,
        },
      }),
    });

    if (!response.ok) {
      throw billingUnavailable();
    }

    body = await response.json();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw billingUnavailable();
  }

  const parsed = partnerResponseSchema.safeParse(body);

  if (!parsed.success || hasGraphQLErrors(parsed.data)) {
    throw billingUnavailable();
  }

  const subscription = parsed.data.data.activeSubscription;

  if (!subscription) {
    return undefined;
  }

  const item = subscription.items[0];
  const planName = item?.description ?? item?.handle;

  return {
    active: true,
    ...(planName ? { planName } : {}),
    test: false,
  };
}

async function loadPlanStatus(admin: PlanAdminClient): Promise<PlanStatus> {
  const shopId = await getShopId(admin);
  const partnerPlan = await getPartnerPlan(shopId);

  if (partnerPlan) {
    return partnerPlan;
  }

  // The Partner API is canonical; the Admin API is only a legacy fallback.
  const fallbackPlan = await getAdminFallbackPlan(admin);
  return fallbackPlan ?? { active: false, test: false };
}

/**
 * Memoized per request. A page that checks the plan twice must issue one
 * upstream lookup and see a consistent answer; the next request re-queries.
 */
const planStatusByRequest = new WeakMap<Request, Promise<PlanStatus>>();

/**
 * Reads the shop's plan from the Partner API, falling back to the Admin API
 * only when the Partner API reports no active subscription.
 *
 * When called with a `Request`, results are memoized per request.
 * Every failure (network, HTTP, malformed body, GraphQL errors, missing
 * credentials) throws `AppError 502 BILLING_UNAVAILABLE` rather than reporting
 * "no plan", so a Shopify outage can never redirect a paying merchant out of
 * the app.
 */
export function getPlanStatus(
  request: Request,
  admin: PlanAdminClient
): Promise<PlanStatus>;
export function getPlanStatus(
  admin: PlanAdminClient
): Promise<PlanStatus>;
export function getPlanStatus(
  requestOrAdmin: Request | PlanAdminClient,
  maybeAdmin?: PlanAdminClient
): Promise<PlanStatus> {
  let request: Request | undefined;
  let admin: PlanAdminClient;

  if (requestOrAdmin instanceof Request) {
    request = requestOrAdmin;
    admin = maybeAdmin!;
  } else {
    admin = requestOrAdmin;
  }

  if (request) {
    const cached = planStatusByRequest.get(request);

    if (cached) {
      return cached;
    }

    const pending = loadPlanStatus(admin);
    planStatusByRequest.set(request, pending);
    return pending;
  }

  return loadPlanStatus(admin);
}

/**
 * Builds the hosted Shopify App Pricing plan-selection URL.
 *
 * The store handle comes from the authenticated session's shop domain, never
 * from the request query string. The app handle is configured in the
 * environment (`SHOPIFY_APP_HANDLE`).
 */
export function buildPricingPlansUrl(shopDomain: string, appHandle: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/i, "").trim();
  const handle = appHandle.trim();

  if (!storeHandle || !handle) {
    throw new AppError(500, "BILLING_CONFIG_INVALID", "Billing plan redirect is not configured.");
  }

  return `https://admin.shopify.com/store/${encodeURIComponent(
    storeHandle
  )}/charges/${encodeURIComponent(handle)}/pricing_plans`;
}
