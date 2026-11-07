# Spec 19 — Admin: lens options and add-ons

**Status:** Not started
**Depends on:** Spec 09, Spec 13, Spec 14, Spec 17
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/routes/app.options._index.tsx`, `app/routes/app.options.$id.tsx`, `app/routes/app.add-ons.$id.tsx`, `app/features/catalog-options/nav.ts`, `app/features/catalog/components/option-value-form.tsx`, `app/features/catalog/admin-options.test.tsx`, `specs/inventory/19-admin-options-addons.md`
**Reuses:** `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/product-sync/` (spec 17), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01)
**Kind:** ui, api
**Invariants:** INV-1, INV-4, INV-7

## Goal

Merchants manage option groups (material/index, tint type, colour) with their values — label, price delta,
lab-code token or override code, swatch — and add-ons, with priced items synced to Shopify.

## Scope

- One page, three sections: option groups (each with ordered values), add-ons. Empty state per section.
- Option value form: label, price delta (money input, ≥ 0), either token (`key=VALUE`) or override code
  (radio), swatch colour for `COLOR` groups (merchant data, stored, not a design token).
- Save → service → `syncItem` when delta > 0 or for add-ons; delta changed to 0 → `archiveItem` on the
  Shopify product and clear the variant id.
- `app/features/catalog-options/nav.ts`: "Options & add-ons", order 20 (own folder because the nav glob
  matches one `nav.ts` per feature folder).

## Explicit non-scope

- Lens groups/lenses → spec 18. Which options apply to which lens → not MVP (all options apply to all lenses).

## Reuse first

- Named in detail: catalog service (14), `syncItem`/`archiveItem` (17), `requireActivePlan` (09), Polaris web components
- Money text → minor units with `parseMoneyText` (spec 13); do not write a second money parser.

## Wiring

Real, used now: 14, 17, 09. Tests: `testConfig()` loader/action calls, fake admin client. Stubbed: none.

## Examples

| Input | Expected | Why this row |
| --- | --- | --- |
| "1.67 High Index", +35.00, token `lens_material=PO-67` | saved delta 3500; synced | normal |
| delta "35.555" | inline error (max 2 decimals for USD) | money precision |
| delta "-5" | inline NEGATIVE_PRICE | invalid |
| both token and override filled | inline ONE_CODE_SOURCE | invalid |
| delta 1500 → 0 | Shopify product drafted, variant id cleared | price removed |

## Steps

1. Routes + actions; 2. value form; 3. Examples tests.

## Self-check

1. Money input parses "35.5" → 3550 without floats (INV-4).
2. The nav glob discovers `catalog-options/nav.ts` (test with the real file).
3. UI checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/catalog/admin-options.test.tsx` passes: every Examples row is a case; empty and populated states render. [unit]
- [ ] INV-1: posting another shop's option value id returns 404, nothing changes. [unit]
- [ ] INV-4: money input converts "35.5" → 3550 and "0.1" → 10 exactly (table test). [unit]
- [ ] INV-7: `rg 'style=|className=|<style' app/routes/app.options* app/routes/app.add-ons* app/features/catalog/components/option-value-form.tsx` finds nothing. [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/19-admin-options-addons.md` lists routes and `OptionValueForm`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
