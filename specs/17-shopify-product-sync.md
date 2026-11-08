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

- [ ] `pnpm vitest run app/features/product-sync` passes: every Examples row is a case; JPY 1500 → "1500". [unit]
- [ ] INV-1: sync for shop B never reads or marks shop A's catalog rows (test with two shops). [unit]
- [ ] INV-4: conversion is integer-based (`rg 'toFixed|parseFloat' app/features/product-sync` finds nothing). [static]
- [ ] Synced lens products are purchasable via `/cart/add.js` and do not appear in storefront search. [requires: Shopify dev store]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/17-shopify-product-sync.md` lists `syncItem`, `archiveItem`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
