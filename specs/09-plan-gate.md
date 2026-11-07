# Spec 09 — Plan gate (Shopify managed pricing)

**Status:** Not started
**Depends on:** Spec 01
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/features/billing/`, `specs/inventory/09-plan-gate.md`
**Reuses:** `app/shopify.server.ts` (spec 01), `app/shared/http/` (spec 01), `../docs/research/stack.md`
**Kind:** api, security
**Invariants:** —

## Goal

Every admin page knows the shop's plan; a shop with no active subscription is sent to Shopify's hosted
plan-selection page instead of using the app.

## Scope

- `getPlanStatus(request, admin)` (or `getPlanStatus(admin)`) → `{ active: boolean, planName?: string, test: boolean }`:
  canonical Shopify App Pricing status queried via Partner API `activeSubscription(appId, shopId)` (stack.md §6);
  Admin GraphQL `currentAppInstallation.activeSubscriptions` is only the fallback when `activeSubscription` is null;
  unpaid only when both are empty. Partner credentials are lazy config keys (`PARTNER_ORGANIZATION_ID`,
  `PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`).
- `requireActivePlan(request)` helper for admin loaders: on no active plan, redirect to the managed pricing
  page URL (`https://admin.shopify.com/store/<handle>/charges/<app-handle>/pricing_plans`, confirm in stack.md).
- Result cached per request only (memoized within one request via WeakMap keyed by Request; no cross-request cache — a plan change must show immediately on the next request).
- The settings page (spec 20) shows `planName`; spec 31 shows a plan step.

## Explicit non-scope

- Defining plans → Partner Dashboard, owner (spec 00 deferred decisions; README Open questions).
- Usage limits per plan → out of MVP (spec 00; flat plans, zero commission).

## Reuse first

- Named in detail: `app/shopify.server.ts` (`authenticate.admin`), `AppError` (spec 01), `../docs/research/stack.md` §6
- Template `authenticate.admin`; do not call `billing.request` (managed pricing forbids it — stack.md §6).

## Wiring

Real, used now: Partner API `activeSubscription` with Admin GraphQL fallback (`currentAppInstallation`). Tests: a fake admin client and mocked fetch returning fixture responses.
Stubbed: none. Consumers: 18–20, 31, 32 call `requireActivePlan` in their loaders.

## Examples

| Subscription response | Expected | Why this row |
| --- | --- | --- |
| Partner API active "Pro" | `{active:true, planName:"Pro", test:false}` | canonical |
| Partner API null, Admin ACTIVE "Pro" | `{active:true, planName:"Pro", test:false}` | fallback |
| none (Partner null, Admin empty) | redirect to pricing page | gate |
| Partner null, Admin one CANCELLED, one ACTIVE | active, the ACTIVE one's name | mixed |
| GraphQL error (Partner or Admin) | `AppError 502 BILLING_UNAVAILABLE`, no redirect loop | failure |
| test subscription on a dev store (Admin) | active, `test:true` | dev store |
| Two lookups during one request | One upstream fetch; memoized result | per-request cache |
| Two lookups across different requests | Re-queried per request boundary | freshness |

## Steps

1. `getPlanStatus` + `requireActivePlan`; 2. every Examples row a test.

## Self-check

1. A GraphQL failure must not redirect (that would loop a merchant out of the app on a Shopify outage).
2. Security checklist: the denied path (no plan) is tested as carefully as the allowed one.

## Done when

- [x] `pnpm vitest run app/features/billing` passes: every Examples row is a case. [unit]
- [ ] A dev store with no plan is redirected to the hosted pricing page; after choosing a test plan the admin loads. [requires: Shopify dev store, plans configured in Partner Dashboard]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/09-plan-gate.md` lists `getPlanStatus`, `requireActivePlan`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-07** — Spec 09 implemented by opencode-1:
  - `getPlanStatus(admin)` in `app/features/billing/plan.server.ts` queries the Admin GraphQL
    `currentAppInstallation.activeSubscriptions { id name status test }`, filters `status === "ACTIVE"`
    and returns `{ active, planName?, test }`. No cross-request cache: each call queries Shopify, proven by a
    two-call test that asserts two GraphQL requests.
  - Every lookup failure (network throw, non-OK HTTP, malformed JSON, schema mismatch, GraphQL `errors`) throws
    `AppError(502, "BILLING_UNAVAILABLE")`; `requireActivePlan` lets it propagate. It never treats an outage as
    "no plan", so it cannot redirect a paying merchant out of the app.
  - `requireActivePlan(request)` in `app/features/billing/require-plan.server.ts` authenticates, attaches `plan`
    to the returned admin context, and on no active plan throws `context.redirect(pricingUrl, { target: "_top" })`
    to `https://admin.shopify.com/store/<store>/charges/<app-handle>/pricing_plans`. The store handle comes only
    from the authenticated session's shop domain; a test passes `?shop=evil.myshopify.com` and asserts the
    redirect still uses the session shop.
  - App handle is configurable: added `SHOPIFY_APP_HANDLE` (default `lens-advisor`) to
    `app/shared/config.server.ts` as `getBillingConfig()` / `getConfig().billing.appHandle`, and documented it in
    `.env.example`. This is the only change outside `app/features/billing/`; it keeps `process.env` confined to
    `config.server.ts` (spec 01's contract). The Partner Dashboard handle can be set there without code changes.
  - Tests: 21 in `app/features/billing` (plan 14, require-plan 5, billing config 2), covering all five Examples
    rows and the denied paths (no plan, auth failure, GraphQL failure, query-string shop spoofing).
  - Gates: `pnpm vitest run app/features/billing` 21/21; `pnpm test` 44/44 across 8 files and both workspace
    projects; `pnpm typecheck` 0 errors; `pnpm lint` 0 errors/0 warnings; `pnpm build` passes.
  - Decision recorded for the lead: `docs/research/stack.md` §6 and the current Shopify App Pricing docs say
    subscription status is canonical via the Partner API `activeSubscription(appId, shopId)`, while this spec's
    Scope and Examples explicitly require Admin GraphQL `currentAppInstallation.activeSubscriptions` and
    `AppError 502` on GraphQL failure. I followed the spec as written. The Partner API path needs a Partner org
    id, a Partner API token and the app GID, none of which spec 01's config declares; if managed-pricing
    subscriptions do not surface via `currentAppInstallation` for this app, a follow-up must add those
    credentials and switch the provider. This is also flagged in the final report.
  - `pnpm vitest run app/features/billing` uses fake admin clients only — no Shopify store, no network.
  - The dev-store box is unticked: it needs a Shopify dev store and plans configured in the Partner Dashboard,
    which the owner provides. Not run by the coder.
- **2026-11-07** — Fix round R1 implemented by opencode-1 (review findings R1-F1, R1-F3):
  - R1-F1: Switched canonical plan lookup to Partner API `activeSubscription(appId, shopId)` using
    `PARTNER_API_VERSION = "2026-10"` and endpoint `https://partners.shopify.com/<orgId>/api/<version>/graphql.json`.
    Admin API `currentAppInstallation.activeSubscriptions` is consulted only as a fallback when `activeSubscription`
    is null. Unpaid status occurs only when both are empty. Partner credentials (`PARTNER_ORGANIZATION_ID`,
    `PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`) added as lazy config keys on `BillingConfig`, documented in `.env.example`.
    All failures (HTTP non-200, network throws, GraphQL errors, schema mismatch, missing credentials) throw
    `AppError(502, "BILLING_UNAVAILABLE")` without redirecting.
  - R1-F3: Added per-request memoization via `WeakMap<Request, Promise<PlanStatus>>`. Multiple calls within the same
    request return the memoized promise; the next request re-queries upstream. Tested both within-request memoization
    and across-request boundaries.
  - Tests: expanded to 32 tests across `app/features/billing` (plan 20, require-plan 6, config 6). All 55 workspace tests pass.
- **2026-11-07** — Evidence (orchestro spec verify, tree d4016cc3): install pass · typecheck pass · lint pass · build pass · test pass 55/0/0
