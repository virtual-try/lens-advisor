# Spec 21 — App proxy: storefront catalog endpoint

**Status:** Done
**Depends on:** Spec 09, Spec 14, Spec 15
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/routes/proxy.catalog.ts`, `app/routes/proxy.catalog.test.ts`, `specs/inventory/21-proxy-catalog-endpoint.md`
**Reuses:** `app/features/billing/` (spec 09), `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/settings/settings.service.server.ts` (spec 15), `packages/rx-core/src/schemas/` (spec 03), `app/shopify.server.ts` (spec 01), `app/shared/http/` (spec 01)
**Kind:** api, security
**Invariants:** INV-1, INV-3, INV-6

## Goal

`GET /apps/lens-advisor/catalog` returns everything the configurator needs for this shop in one response:
lens groups, lenses with limits and variant ids, option groups, add-ons, and the shopper-facing settings.

## Scope

- Verify the proxy signature first; shop from the verified request only.
- Response = spec 03 catalog schema: catalog + `settings: { manualRxEnabled, rxUploadEnabled, storeRxInOrder }`
  (the configurator needs `storeRxInOrder` to build cart properties, INV-3). Nothing else from settings —
  never lab emails.
- `Cache-Control: private, max-age=60`; response validated against the schema before sending (a server bug
  becomes a 500, not a malformed catalog).
- Shop not installed or no active plan → 404 `NOT_AVAILABLE` (the button then hides, spec 16's empty state).

## Explicit non-scope

- Prescription endpoints → spec 22. Product-specific catalogs → not MVP (one catalog per shop).

## Reuse first

- Named in detail: `getPlanStatus` (09), `getStorefrontCatalog` (14), `getSettings` (15), catalog response schema (03), `authenticate.public.appProxy`, `AppError` (01)
- Template `authenticate.public.appProxy`; spec 03 schema for the response.

## Wiring

Real, used now: 14, 15. Tests: signed and unsigned proxy requests built with the template test helpers.
Stubbed: none. Consumer: configurator API client (16) at runtime; e2e flow (33).

## Examples

| Request | Expected | Why this row |
| --- | --- | --- |
| valid signature, shop A | 200, A's catalog only | normal |
| missing/forged signature | 401, no repository call | INV-6 |
| `?shop=B` added to A's signed request | still A's catalog (signature covers params) | INV-1 |
| shop with no catalog | 200 with empty groups | empty |
| response includes `labEmails` | never — test asserts absent | leak |

## Steps

1. Route; 2. Examples tests with a spy on the services.

## Self-check

1. The unsigned path calls nothing (spy asserts zero calls) — INV-6.
2. API checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/routes/proxy.catalog.test.ts` passes: every Examples row is a case. [unit]
- [ ] INV-1: shop is taken from the verified session; a test with two shops proves isolation. [unit]
- [ ] INV-3: the response carries `storeRxInOrder` and never `labEmails`. [unit]
- [ ] INV-6: a forged request returns 401 and no service is called. [unit]
- [ ] `curl` through the storefront `/apps/lens-advisor/catalog` on a dev store returns the catalog. [requires: Shopify dev store]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/21-proxy-catalog-endpoint.md` lists the endpoint and its response schema. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
