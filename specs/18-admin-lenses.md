# Spec 18 — Admin: lens groups and lenses

**Status:** Not started
**Depends on:** Spec 09, Spec 10, Spec 12, Spec 13, Spec 14, Spec 17
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/routes/app.lenses._index.tsx`, `app/routes/app.lenses.$id.tsx`, `app/routes/app.lens-groups.$id.tsx`, `app/features/catalog/nav.ts`, `app/features/catalog/components/lens-form.tsx`, `app/features/catalog/admin-lenses.test.tsx`, `specs/inventory/18-admin-lenses.md`
**Reuses:** `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/product-sync/` (spec 17), `packages/rx-core/src/lab-code/` (spec 12), `packages/rx-core/src/rx/parse.ts` (spec 10), `packages/rx-core/src/format/` (spec 03), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01)
**Kind:** ui, api
**Invariants:** INV-1, INV-5, INV-7

## Goal

Merchants can create, edit, reorder and archive lens groups and lenses — name, description, price, allowed
Rx types, SPH/CYL/ADD limits and lab-code template — and every saved lens is synced to Shopify.

## Scope

- List page: groups as sections, lenses inside with price, Rx types, limits summary ("SPH −8.00 to +6.00"),
  sync status badge (Synced / Not synced / Sync failed with Retry); empty state with "Add lens group".
- Lens form: text fields for limits take diopter text and are parsed with spec 10's parser (so "−8.00"
  and "-8" both work); lab-code template field shows `validateTemplate` errors inline and a live preview
  with default tokens.
- Actions: validate (service), save, then `syncItem`; a sync failure keeps the save and shows the badge.
  Archive asks for confirmation (`<s-modal>`), then `archiveItem`.
- Loaders call `requireActivePlan`. `nav.ts`: "Lenses", order 10.

## Explicit non-scope

- Options, add-ons → spec 19. Settings → spec 20.

## Reuse first

- Named in detail: catalog service (14), `syncItem`/`archiveItem` (17), `validateTemplate` (12), `parseDiopterText`/`formatDiopter` (10, 03), `requireActivePlan` (09), Polaris web components
- spec 10 parser and spec 03 formatter for limits — no local diopter parsing.
- `parseMoneyText` (spec 13) for the price field — no local money parsing.
- Polaris web components only; no custom CSS (INV-7).

## Wiring

Real, used now: services 14, 17, 12, 09. Tests: route loader/action called with `testConfig()`, fake admin client.
Stubbed: none.

## Examples

| Form input | Expected | Why this row |
| --- | --- | --- |
| SPH min "-8", max "+6.00" | saved −800/600; list shows "SPH −8.00 to +6.00" | normal |
| SPH min "+6", max "-8" | inline error on SPH max (LIMITS_INVERTED) | invalid |
| template `PO-[x=A` | inline UNCLOSED_TOKEN, save disabled | template error |
| save ok, Shopify sync fails | saved; badge "Sync failed", Retry visible | partial failure |
| archive confirmed | gone from list, product drafted | archive |

## Steps

1. Routes + loaders/actions; 2. form component; 3. tests for every Examples row via actions and rendered output.

## Self-check

1. Action reads `shopId` from the authenticated session only, never from form data (INV-1).
2. A sync failure never rolls back the DB save, and Retry calls `syncItem` again idempotently.
3. UI checklist (`spec-quality.md` §8) — loading, empty, error, populated states of the list.

## Done when

- [ ] `pnpm vitest run app/features/catalog/admin-lenses.test.tsx` passes: every Examples row is a case; list renders empty, populated and sync-failed states. [unit]
- [ ] INV-1: an action posting another shop's lens id returns 404 and changes nothing. [unit]
- [ ] INV-5: limits entered as text are stored as integer hundredths (asserted on the repository). [unit]
- [ ] INV-7: `rg 'style=|className=|<style' app/routes/app.lens* app/features/catalog/components` finds nothing. [static]
- [ ] A merchant creates a lens on a dev store and the Shopify product appears with the right price. [requires: Shopify dev store]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/18-admin-lenses.md` lists the routes and `LensForm`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
