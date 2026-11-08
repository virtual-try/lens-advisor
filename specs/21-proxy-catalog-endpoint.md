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

- [x] `pnpm vitest run app/routes/proxy.catalog.test.ts` passes: every Examples row is a case. [unit]
- [x] INV-1: shop is taken from the verified session; a test with two shops proves isolation. [unit]
- [x] INV-3: the response carries `storeRxInOrder` and never `labEmails`. [unit]
- [x] INV-6: a forged request returns 401 and no service is called. [unit]
- [ ] `curl` through the storefront `/apps/lens-advisor/catalog` on a dev store returns the catalog. [requires: Shopify dev store]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/21-proxy-catalog-endpoint.md` lists the endpoint and its response schema. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 21 implemented by agy-2 (engine agy) in worktree `spec-21` (branch `spec/21-proxy-catalog-endpoint`). No git writes (lead commits).
  - Implemented `app/routes/proxy.catalog.ts`: Handles `GET /apps/lens-advisor/catalog` proxied to `/proxy/catalog`.
    - Authenticates app proxy HMAC signature first via `authenticate.public.appProxy(request)`, throwing `UnauthorizedError` (401 `UNAUTHORIZED`) before running any logic, DB reads, or method validations on invalid or missing signatures (INV-6, R111).
    - Derives tenancy strictly from verified offline session `context.session.shop`, rejecting missing sessions with 404 `NOT_AVAILABLE` (INV-1).
    - Verifies HTTP method (`GET`/`HEAD` on loader, rejecting non-GET with 400 `METHOD_NOT_ALLOWED` in action after verified auth).
    - Resolves shop in Postgres via `prisma.shop.findUnique({ where: { domain: shopDomain } })`. Rejects missing or uninstalled shops (`uninstalledAt !== null`) with 404 `NOT_AVAILABLE`.
    - Verifies active billing plan via `getPlanStatus(request, context.admin)` (spec 09); inactive plan returns 404 `NOT_AVAILABLE`, while billing outages return 502 `BILLING_UNAVAILABLE`.
    - Concurrently retrieves catalog data via `getStorefrontCatalog(shop.id, { prisma })` (spec 14) and shop settings via `getSettings(shop.id, prisma)` (spec 15).
    - Assembles `CatalogResponse` conforming to spec 03 DTO, including `settings: { manualRxEnabled, rxUploadEnabled, storeRxInOrder }` and strictly omitting `labEmail`/`labEmails` and `ticketFormat` (INV-3).
    - Validates assembled payload through `catalogResponseSchema.parse` before sending; any schema mismatch returns 500 `INVALID_CATALOG_RESPONSE`.
    - Returns `200 OK` with JSON payload and header `Cache-Control: private, max-age=60`.
  - Implemented `app/routes/proxy.catalog.test.ts`:
    - 15 unit tests covering all 5 Examples table rows, INV-1 multi-tenant shop isolation, INV-3 order privacy and leak prevention, INV-6 unauthenticated/forged call prevention with spies, 404 on uninstalled/inactive plan, 502 on billing failure, 500 on malformed schema validation, and method validation.
  - Implemented `specs/inventory/21-proxy-catalog-endpoint.md`:
    - Documented `proxy-catalog-endpoint` and `catalog-response-schema`.
  - Self-check 1: checked, holds. Unsigned and forged requests call zero services or repositories. Spies on shop repository read (`prisma.shop.findUnique`), `getStorefrontCatalog`, `getSettings`, and `getPlanStatus` assert zero calls (`toHaveBeenCalledTimes(0)`) for both unsigned and forged requests.
  - Self-check 2: API checklist (`spec-quality.md` §8) checked, holds. Authentication-first, safe error payloads via `errorResponse`, strict status codes (200, 400, 401, 404, 500, 502), response validated against Zod schema, Cache-Control set, shop isolation proven across two shops.
  - Sabotage: bypassed proxy signature authentication in route -> `unsignedRes.status` returned 200 instead of 401 (`AssertionError: expected 200 to be 401`); restored, green.
  - Sabotage 2: injected float price into catalog response -> `catalogResponseSchema.parse` rejected payload, returning 500 `INVALID_CATALOG_RESPONSE`; restored, green.
  - Gates after last code change:
    - `pnpm vitest run app/routes/proxy.catalog.test.ts` -> 15 passed (15)
    - `pnpm test` -> 33 passed (33) files, 522 passed (522) tests
    - `pnpm typecheck` -> exit 0
    - `pnpm lint` (`eslint . --max-warnings 0`) -> exit 0
    - `pnpm build` -> exit 0
  - The dev-store box is unticked: requires a Shopify dev store and app proxy configured in Partner Dashboard, which the owner provides. Not run by the coder.
- **2026-11-08** — Fix round R1 by agy-2 addressing rev-codex review findings:
  - R1-F1: Updated Examples Row 3 test in `app/routes/proxy.catalog.test.ts` to test literally: arranged a verified app-proxy request whose query URL carries `shop=B` (`shop-b-catalog.myshopify.com`) while `authenticate.public.appProxy` returns session A (`shop-a-catalog.myshopify.com`); asserted 200 OK returning Shop A's catalog, asserted `catalogService.getStorefrontCatalog` was called with `shopA.shopId` only (0 calls with `shopB.shopId`), and asserted `prisma.shop.findUnique` was called for domain A only.
  - R1-F2: Added spies on shop repository read (`prisma.shop.findUnique`) alongside `catalogService.getStorefrontCatalog`, `settingsService.getSettings`, and `getPlanStatus` for both unsigned and forged requests in Row 2 and Self-check 1 (INV-6); asserted zero calls (`toHaveBeenCalledTimes(0)`) on each. Fixed Self-check 1 documentation in the Log so it states exactly what is asserted.
- **2026-11-08** — Evidence (orchestro spec verify, tree fb9deae2): install pass · typecheck pass · lint pass · build pass · test pass 575/0/0
