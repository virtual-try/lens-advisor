import { authenticate } from "../../shopify.server";
import { getConfig } from "../../shared/config.server";

import { buildPricingPlansUrl, getPlanStatus, type PlanStatus } from "./plan.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;

export type ActivePlanContext = AdminAuthContext & { plan: PlanStatus };

/**
 * Gate for admin loaders.
 *
 * Authenticates the request, checks the shop's plan and returns the normal
 * admin context with the plan attached. A shop without an active plan is
 * redirected to Shopify's hosted plan-selection page at the top frame.
 *
 * A failed plan lookup is not a reason to redirect: `getPlanStatus` throws
 * `AppError 502 BILLING_UNAVAILABLE` and this helper lets it propagate, so a
 * Shopify outage can never lock a merchant out of the app.
 */
export async function requireActivePlan(request: Request): Promise<ActivePlanContext> {
  const context = await authenticate.admin(request);
  const plan = await getPlanStatus(context.admin);

  if (!plan.active) {
    const pricingUrl = buildPricingPlansUrl(
      context.session.shop,
      getConfig().billing.appHandle
    );

    throw context.redirect(pricingUrl, { target: "_top" });
  }

  return { ...context, plan };
}
