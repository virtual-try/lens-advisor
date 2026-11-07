import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

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

/**
 * Shopify App Pricing subscriptions are exposed on the current app
 * installation. `activeSubscriptions` only returns active ones, but the status
 * is still checked so a mixed/partial payload can never grant access.
 */
export const PLAN_STATUS_QUERY = `#graphql
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

const appSubscriptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  test: z.boolean(),
});

const planResponseSchema = z.object({
  data: z.object({
    currentAppInstallation: z.object({
      activeSubscriptions: z.array(appSubscriptionSchema),
    }),
  }),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

function billingUnavailable(): AppError {
  return new AppError(
    502,
    "BILLING_UNAVAILABLE",
    "Unable to verify the app subscription with Shopify. Please try again shortly."
  );
}

/**
 * Reads the shop's plan from the Admin GraphQL API.
 *
 * Deliberately uncached: a plan change must be visible on the next request.
 * Every failure (network, HTTP, malformed body, GraphQL errors) throws
 * `AppError 502 BILLING_UNAVAILABLE` rather than reporting "no plan", so a
 * Shopify outage can never redirect a paying merchant out of the app.
 */
export async function getPlanStatus(admin: PlanAdminClient): Promise<PlanStatus> {
  let body: unknown;

  try {
    const response = await admin.graphql(PLAN_STATUS_QUERY);

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

  const parsed = planResponseSchema.safeParse(body);
  if (!parsed.success || (parsed.data.errors?.length ?? 0) > 0) {
    throw billingUnavailable();
  }

  const activeSubscription = parsed.data.data.currentAppInstallation.activeSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE"
  );

  if (!activeSubscription) {
    return { active: false, test: false };
  }

  return {
    active: true,
    planName: activeSubscription.name,
    test: activeSubscription.test,
  };
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
