# Spec 17 — Shopify product sync for lenses, options and add-ons

**Status:** Done
**Depends on:** Spec 13, Spec 14
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/features/product-sync/`, `specs/inventory/17-shopify-product-sync.md`
**Reuses:** `app/features/catalog/catalog.service.server.ts` (spec 14), `app/shopify.server.ts` (spec 01)
**Kind:** integration
**Invariants:** INV-1, INV-4

## Goal

Every purchasable catalog item — each lens, each option value with a price above zero, each add-on — has a
Shopify product variant at the right price, so the configurator can add it as a nested child line.

## Scope

- `syncItem(admin, shopId, entity, id)`: create or update one product (title "Lens: <name>" etc., vendor
  "Lens Advisor", tag `lens-advisor-item`, one variant at the item's price, not taxable-changed, inventory
  not tracked, `seo.hidden` metafield = 1 so it stays out of search and sitemaps), publish to the Online
  Store channel, then `markSynced`. Idempotent: an item with a `shopifyVariantId` is updated, not recreated.
- `archiveItem`: set the Shopify product to draft when the catalog row is archived.
- Called from the admin actions in specs 18/19 after a successful save (synchronous, one item per save).
- Price changes update the variant price; currency mismatch with the shop currency → `CURRENCY_MISMATCH`.

## Explicit non-scope

- Admin forms → specs 18, 19. Bulk import → not MVP.
- Hiding items from collections the merchant builds by hand → left to a human (spec 00); README Open questions.

## Reuse first

- Named in detail: catalog service `markSynced`, getters (spec 14); template Admin GraphQL client
- Template Admin GraphQL client from `authenticate.admin` — do not build a REST client.

## Wiring

Real, used now: Admin GraphQL. Tests: fake admin client recording mutations. Stubbed: none. Consumers: 18, 19.

## Examples

| Case | Expected | Why this row |
| --- | --- | --- |
| new lens, price 8000 USD | productCreate + variant price "80.00", `markSynced` called | normal |
| same lens saved again with 9000 | variant update only, no create | idempotent |
| option value delta 0 | no product; no variant id | zero price |
| option delta 0 → 1500 | product created | becomes priced |
| archived lens | product set to DRAFT | archive |
| GraphQL userErrors | `SyncError` with the Shopify message; catalog row unchanged | failure |

## Steps

1. Mutations + mapping (minor units → decimal string via `toShopifyDecimal`, spec 13);
2. every Examples row a test with the fake client.

## Self-check

1. Minor units → decimal string conversion handles 3-decimal and 0-decimal currencies (JPY) — INV-4.
2. Never creates a duplicate product on retry (look up by stored id first).
3. Integration checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/features/product-sync` passes: every Examples row is a case; JPY 1500 → "1500". [unit]
- [x] INV-1: sync for shop B never reads or marks shop A's catalog rows (test with two shops). [unit]
- [x] INV-4: conversion is integer-based (`rg 'toFixed|parseFloat' app/features/product-sync` finds nothing). [static]
- [ ] Synced lens products are purchasable via `/cart/add.js` and do not appear in storefront search. [requires: Shopify dev store]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/17-shopify-product-sync.md` lists `syncItem`, `archiveItem`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 17 implemented by agy-1 in worktree `spec-17` (branch `spec/17-shopify-product-sync`). No git writes (lead commits).
  - Module `app/features/product-sync/`:
    - `types.ts`: `ProductSyncAdminClient`, `SyncEntity`, `ProductSyncDeps`, `SyncItemResult`, `ArchiveItemResult`.
    - `errors.ts`: `SyncError` extending `AppError` (HTTP 400) with code `SYNC_FAILED` / `CURRENCY_MISMATCH`.
    - `graphql.ts`: `SHOP_CURRENCY_QUERY`, `GET_PUBLICATIONS_QUERY`, `GET_VARIANT_PRODUCT_QUERY`, `PRODUCT_CREATE_MUTATION`, `PRODUCT_VARIANTS_BULK_UPDATE_MUTATION`, `PUBLISHABLE_PUBLISH_MUTATION`, `PRODUCT_UPDATE_MUTATION`.
    - `product-sync.server.ts`: Implemented `syncItem` and `archiveItem` functions.
    - `index.ts`: Barrel export of all functions, types, and errors.
    - `product-sync.server.test.ts`: 23 DB-backed unit and integration tests with fake Admin GraphQL client recording mutations.
  - Inventory fragment: `specs/inventory/17-shopify-product-sync.md` created, documenting `syncItem`, `archiveItem`, and `SyncError`.
  - Decisions:
    1. Titles: `"Lens: " + lens.name`, `"Option: " + optionValue.label`, `"Add-on: " + addOn.name`.
    2. Tags: `["lens-advisor-item"]`, vendor `"Lens Advisor"`, status `"ACTIVE"`, and metafield `{ namespace: "seo", key: "hidden", value: "1", type: "number_integer" }` so synced items remain hidden from search and sitemaps.
    3. Decimal string conversion: Uses `toShopifyDecimal` from spec 13 (INV-4) with zero float math. Taxable is left unchanged (not taxable-changed); inventory is set to untracked (`inventoryItem: { tracked: false }`).
    4. Currency check: Queries `shop { currencyCode }` from Shopify; if item currency differs, throws `SyncError` with code `CURRENCY_MISMATCH` before creating any product.
    5. Option delta 0: Skips product creation (`{ ok: true, skipped: true }`) without calling Shopify Admin or assigning a variant ID.
    6. Idempotent retry: Checks stored `shopifyVariantId` on the item first; if present, updates variant price via `productVariantsBulkUpdate`, never recreating the product.
    7. Publishing: Queries publications for `"Online Store"` and publishes via `publishablePublish`.
    8. Archiving: `archiveItem` sets product status to `"DRAFT"` via `productUpdate`. If item was never synced, returns `{ ok: true, archived: false, reason: "NOT_SYNCED" }`.
    9. Tenant isolation (INV-1): All catalog reads and writes filter by `shopId` through `catalogService`. Cross-shop access throws `NotFoundError` and executes no mutations.
    10. Owner-gated box `[requires: Shopify dev store]` left unticked per R7 and AGENT-GUIDE.md; owner/lead verifies on a dev store.
  - Self-check 1: checked, holds. JPY 1500 formats as `"1500"` (0 fraction digits) and KWD 1500 formats as `"1.500"` (3 fraction digits) using integer arithmetic. Static check `rg 'toFixed|parseFloat' app/features/product-sync` exits 1 with no output.
  - Self-check 2: checked, holds. Look up by stored `shopifyVariantId` prevents duplicate product creation on retry; test asserts `ProductCreate` call count is 1 after multiple successive sync calls on the same item.
  - Self-check 3: integration checklist holds. Real Admin GraphQL client from `authenticate.admin` supported; fake client in tests records queries and verifies variables. GraphQL userErrors and top-level errors throw `SyncError`. No `process.env` in owned files.
  - Sabotage 1 (retry idempotency): Disabled stored variant ID check (`if (false && storedVariantId)`) -> 4 tests failed in `app/features/product-sync/product-sync.server.test.ts` (`AssertionError: expected undefined to be true` on `secondSync.updated` and duplicate create assertions); restored, green.
  - Sabotage 2 (decimal conversion): Appended `"99"` to `decimalPrice` -> 8 tests failed (`AssertionError: expected '150099' to be '1500'`, `expected '1.50099' to be '1.500'`); restored, green.
  - Sabotage 3 (tenant isolation): Bypassed `shopId` scoping in `syncItem` -> 7 tests failed (`AssertionError: expected 1 to be +0` on `fake.countCalls("ProductCreate")` for cross-shop call, plus currency mismatches); restored, green.
  - Gates after the last change:
    - `pnpm vitest run app/features/product-sync` -> `Test Files  1 passed (1)` / `Tests  23 passed (23)`
    - `pnpm test` -> `Test Files  33 passed (33)` / `Tests  530 passed (530)`
    - `pnpm typecheck` -> exit 0
    - `pnpm lint` (`eslint . --max-warnings 0`) -> exit 0
    - `pnpm build` -> exit 0
    - `git diff --check` -> exit 0
- **2026-11-08** — Evidence (orchestro spec verify, tree 8906caea): install pass · typecheck pass · lint pass · build pass · test pass 662/0/0
- **2026-11-08** — Review R1 fixes applied by agy-1:
  - R1-F2: Persist Shopify product and variant IDs immediately after `productCreate` succeeds via `markSynced`. On partial failure before publish, retry reuses the stored IDs without duplicating the product. Added compensation (`PRODUCT_DELETE_MUTATION`) to delete the newly created product if persisting fails immediately after creation before throwing `SyncError`.
  - R1-F3: Added `findOnlineStorePublicationId` helper paginating `publications(first: 50, after: $after)` until "Online Store" is found. If absent, throws `SyncError` and does not call `markSynced` or `productCreate`.
  - Tests: Added tests for variant update failure retry (exactly 1 `ProductCreate` call overall, stored ID reused), compensation on persist failure, publication pagination on later page, and absent publication failure.
  - Gates: test 533 passed (33 files), typecheck passed, lint passed, build passed.
- **2026-11-08** — Review R3 fixes applied by agy-1:
  - R3-F1: Switched `seo.hidden` metafield type from invalid `"integer"` to `"number_integer"` in both `productCreate` and `productUpdate` mutations. Fake client rejects `"integer"` with Shopify user error.
  - R3-F2: Extracted shared `buildProductInput` builder ensuring title, vendor (`"Lens Advisor"`), tags (`["lens-advisor-item"]`), status (`"ACTIVE"`), and metafields are identical between create and the stored-ID update path, restoring drifted vendor or tags on resync.
  - Tests: Added regression tests verifying `number_integer` metafield type and drifted vendor/tags restoration.
  - Gates: test 540 passed (33 files), typecheck passed, lint passed, build passed.
