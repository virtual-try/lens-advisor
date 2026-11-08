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

- [x] `pnpm vitest run app/features/catalog/admin-options.test.tsx` passes: every Examples row is a case; empty and populated states render. [unit]
- [x] INV-1: posting another shop's option value id returns 404, nothing changes. [unit]
- [x] INV-4: money input converts "35.5" → 3550 and "0.1" → 10 exactly (table test). [unit]
- [x] INV-7: `rg 'style=|className=|<style' app/routes/app.options* app/routes/app.add-ons* app/features/catalog/components/option-value-form.tsx` finds nothing. [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/19-admin-options-addons.md` lists routes and `OptionValueForm`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Implemented Spec 19 (Admin: lens options and add-ons) by agy-1:
  - Created `app/features/catalog-options/nav.ts` exporting `{ label: "Options & add-ons", href: "/app/options", order: 20 }` in isolated feature folder for auto-discovery by nav glob.
  - Implemented `app/features/catalog/components/option-value-form.tsx` using Polaris web components (`s-stack`, `s-text-field`, `s-choice-list`, `s-choice`, `s-banner`, `s-button`) without any CSS classes or inline styles (INV-7). Provides label, price delta, code source choice (lab token `key=VALUE` vs override `overrideCode`), swatch colour for `COLOR` group kind, and inline validation errors.
  - Implemented `app/routes/app.options._index.tsx` presenting 3 sections ("Material & index", "Tint & colour", "Add-ons") with empty and populated states, group modal, deletion, and reordering.
  - Implemented `app/routes/app.options.$id.tsx` for creating/updating option values scoped to `session.shop`. Uses `parseMoneyText` without floating-point math (INV-4), validates code source exclusivity (`ONE_CODE_SOURCE`), syncs to Shopify via `syncItem` on positive delta, and calls `archiveItem` + clears `shopifyVariantId` on delta reduction to 0. Enforces tenant isolation (INV-1) by returning 404 for missing or cross-shop IDs.
  - Implemented `app/routes/app.add-ons.$id.tsx` for add-ons CRUD scoped to `session.shop`. Parses price with `parseMoneyText`, triggers `syncItem`, and archives Shopify variant and DB row on archive action.
  - Created inventory file `specs/inventory/19-admin-options-addons.md`.
  - Created `app/features/catalog/admin-options.test.tsx` containing 24 tests covering all 5 Examples rows, INV-1 cross-tenant 404, INV-4 money conversion table test, nav discovery, empty/populated section renders, and add-on CRUD.
  - Sabotages executed and verified:
    1. Sabotage 1 (code exclusivity): Removed check for both token and override in `app/routes/app.options.$id.tsx` -> `AssertionError: expected 200 to be 400` in `admin-options.test.tsx`; restored, green.
    2. Sabotage 2 (variant clearing): Bypassed clearing `shopifyVariantId` on delta 1500 -> 0 in `app/routes/app.options.$id.tsx` -> `AssertionError: expected 'gid://shopify/ProductVariant/555' to be null` in `admin-options.test.tsx`; restored, green.
    3. Sabotage 3 (tenant isolation): Replaced `NotFoundError` 404 response with 200 on cross-shop option value update in `app/routes/app.options.$id.tsx` -> `AssertionError: expected 200 to be 404` in `admin-options.test.tsx`; restored, green.
  - Gates:
    - `pnpm vitest run app/features/catalog/admin-options.test.tsx` -> 24 passed (24)
    - `pnpm test` -> 43 files passed (43), 686 tests passed (686)
    - `rg 'style=|className=|<style' app/routes/app.options* app/routes/app.add-ons* app/features/catalog/components/option-value-form.tsx` -> 0 matches (exit 1)
    - `pnpm typecheck` -> exit 0 (0 errors)
    - `pnpm lint` -> exit 0 (0 errors, 0 warnings)
    - `pnpm build` -> exit 0
    - `git diff --check` -> exit 0
- **2026-11-08** — Evidence (orchestro spec verify, tree 0c34f01a): install pass · typecheck pass · lint pass · build pass · test pass 715/0/0
- **2026-11-08** — Addressed Review R4 findings:
  - R4-F1: Retain `shopifyVariantId` on price update `syncItem` failures, return `syncFailed: true`, and show badge with Retry; updated R3-F1 test to assert ID retention and that Retry calls update rather than create (both routes).
  - R4-F2: Removed `requestSubmit` `onClick` handlers from submit buttons, using native submit alone; tested that one click triggers exactly one action call.
  - R4-F3: Query shop currency via `ShopCurrency` in loaders and use for new options/add-ons; throws 500 `CURRENCY_UNAVAILABLE` if unavailable. Tested with JPY shop.
  - R4-F5: Recorded intentional cross-owner edits in `app/features/catalog/schema.ts` and `packages/rx-core/src/pricing/index.ts` in spec Log.
  - R4-F6: Triggered archive when `priceDeltaMinor === 0 && hadVariant` to cleanly clear leftover variant IDs from earlier failed archives.
  - R4-F7: Eliminated test scaffolding `try/catch` around `useNavigation` in production route components and wrapped test renders in data routers.
  - R4-F8: Removed duplicate `name="codeType"` from choice list so `codeType` is posted once via the hidden input.
  - R4-F9: Added test asserting index page disables all interactive buttons during submission, and INV-1 test for cross-tenant option value creation returning 404.
  - Gates:
    - `pnpm vitest run app/features/catalog/admin-options.test.tsx` -> 53 passed (53)
    - `pnpm test` -> 43 files passed (43), 715 tests passed (715)
    - `rg 'style=|className=|<style' app/routes/app.options* app/routes/app.add-ons* app/features/catalog/components/option-value-form.tsx` -> 0 matches (exit 1)
    - `pnpm typecheck` -> exit 0 (0 errors)
    - `pnpm lint` -> exit 0 (0 errors, 0 warnings)
    - `pnpm build` -> exit 0
    - `git diff --check` -> exit 0
- **2026-11-08** — Addressed Review R3 and R4 findings (Spec 18 R6-F1/F2 Ruling):
  - R3-F1: Surfaced and persisted positive-price sync failures on options and add-ons with Retry button on both detail and list views.
  - R3-F2: Maintained mapping when token/override is omitted on partial updates, and cleared only on explicit selection ("none" or mode switch).
  - R3-F3: Enforced prevention of deleting populated option groups with 409 `GROUP_NOT_EMPTY`.
  - R3-F4: Required positive price (`> 0`) on add-on creation/updates with structured 400 error.
  - R3-F5: Clarified help text to reference shop normal currency units rather than minor units.
  - R4-F1: Migrated forms to React Router `<Form>` to ensure submissions dispatch through the router and display inline error banners.
  - R4-F2: Conditioned `disabled` and `loading` attributes so web-component boolean attributes are completely omitted when false.
  - Added 10 verification test cases in `app/features/catalog/admin-options.test.tsx` (total 47 tests passed).
  - Gates:
    - `pnpm vitest run app/features/catalog/admin-options.test.tsx` -> 47 passed (47)
    - `pnpm test` -> 43 files passed (43), 709 tests passed (709)
    - `rg 'style=|className=|<style' app/routes/app.options* app/routes/app.add-ons* app/features/catalog/components/option-value-form.tsx` -> 0 matches (exit 1)
    - `pnpm typecheck` -> exit 0 (0 errors)
    - `pnpm lint` -> exit 0 (0 errors, 0 warnings)
    - `pnpm build` -> exit 0
    - `git diff --check` -> exit 0
