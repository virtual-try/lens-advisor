# Inventory fragment — Spec 09 (Plan gate, Shopify App Pricing)

### `get-plan-status`
`app/features/billing/plan.server.ts` — `getPlanStatus(admin)` queries the Admin GraphQL `currentAppInstallation.activeSubscriptions` (`id`, `name`, `status`, `test`), returns `{ active, planName?, test }` after filtering on `status === "ACTIVE"`, and is deliberately uncached. Any failure (network, non-OK HTTP, malformed body, GraphQL `errors`) throws `AppError(502, "BILLING_UNAVAILABLE")`; it never reports "no plan" on an outage.
**Use instead of:** ad-hoc `currentAppInstallation` subscription queries, or `billing.request` (Shopify App Pricing forbids it).
**Added by:** spec 09.

### `require-active-plan`
`app/features/billing/require-plan.server.ts` — `requireActivePlan(request)` authenticates the admin request, returns the normal admin context with `plan` attached, and throws a top-frame redirect to Shopify's hosted plan-selection page when the shop has no active plan. Lookup failures propagate as `AppError 502` and never redirect.
**Use instead of:** calling `authenticate.admin` and checking the plan separately in each admin loader.
**Added by:** spec 09.

### `pricing-plans-url`
`app/features/billing/plan.server.ts` — `buildPricingPlansUrl(shopDomain, appHandle)` builds `https://admin.shopify.com/store/<store>/charges/<app-handle>/pricing_plans`; the store handle is derived from the authenticated session's shop domain.
**Use instead of:** hardcoding a plan-selection URL in a route.
**Added by:** spec 09.

### `billing-config`
`app/shared/config.server.ts` — `getConfig().billing.appHandle` (also `getBillingConfig()`) reads the optional `SHOPIFY_APP_HANDLE` env var, defaulting to `lens-advisor`; this is the app handle used in the hosted pricing URL.
**Use instead of:** reading `process.env` from billing or route code.
**Added by:** spec 09.
