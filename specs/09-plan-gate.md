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

- `getPlanStatus(admin)` → `{ active: boolean, planName?: string, test: boolean }` from the Admin GraphQL
  current app installation's active subscriptions (query confirmed in stack.md §6).
- `requireActivePlan(request)` helper for admin loaders: on no active plan, redirect to the managed pricing
  page URL (`https://admin.shopify.com/store/<handle>/charges/<app-handle>/pricing_plans`, confirm in stack.md).
- Result cached per request only (no cross-request cache — a plan change must show immediately).
- The settings page (spec 20) shows `planName`; spec 31 shows a plan step.

## Explicit non-scope

- Defining plans → Partner Dashboard, owner (spec 00 deferred decisions; README Open questions).
- Usage limits per plan → out of MVP (spec 00; flat plans, zero commission).

## Reuse first

- Named in detail: `app/shopify.server.ts` (`authenticate.admin`), `AppError` (spec 01), `../docs/research/stack.md` §6
- Template `authenticate.admin`; do not call `billing.request` (managed pricing forbids it — stack.md §6).

## Wiring

Real, used now: Admin GraphQL via the template client. Tests: a fake admin client returning fixture responses.
Stubbed: none. Consumers: 18–20, 31, 32 call `requireActivePlan` in their loaders.

## Examples

| Subscription response | Expected | Why this row |
| --- | --- | --- |
| one ACTIVE "Pro" | `{active:true, planName:"Pro"}` | normal |
| none | redirect to pricing page | gate |
| one CANCELLED, one ACTIVE | active, the ACTIVE one's name | mixed |
| GraphQL error | `AppError 502 BILLING_UNAVAILABLE`, no redirect loop | failure |
| test subscription on a dev store | active, `test:true` | dev store |

## Steps

1. `getPlanStatus` + `requireActivePlan`; 2. every Examples row a test.

## Self-check

1. A GraphQL failure must not redirect (that would loop a merchant out of the app on a Shopify outage).
2. Security checklist: the denied path (no plan) is tested as carefully as the allowed one.

## Done when

- [ ] `pnpm vitest run app/features/billing` passes: every Examples row is a case. [unit]
- [ ] A dev store with no plan is redirected to the hosted pricing page; after choosing a test plan the admin loads. [requires: Shopify dev store, plans configured in Partner Dashboard]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/09-plan-gate.md` lists `getPlanStatus`, `requireActivePlan`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
