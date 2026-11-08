# Spec 28 — Configurator steps 5–6: options, add-ons and price summary

**Status:** Not started
**Depends on:** Spec 13, Spec 16
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/configurator/src/steps/05-options/`, `packages/configurator/src/steps/06-add-ons/`, `packages/configurator/src/price-summary/`, `specs/inventory/28-step-options-addons.md`
**Reuses:** `packages/configurator/src/shell/` (spec 16), `packages/configurator/src/shared/` (spec 16), `packages/rx-core/src/pricing/` (spec 13), `design/v3/options.html`, `DESIGN-SYSTEM.md#component-conventions`
**Kind:** ui
**Invariants:** INV-4, INV-7, INV-9

## Goal

The shopper picks one value per option group (material, tint type, colour) and any add-ons, watching a
running price summary that the footer and the review step reuse.

## Scope

- Step 5: one radio group per option group, in catalog order; colour group as swatches with names (swatch
  colour is merchant data, applied as an inline custom property value — the only allowed non-token colour,
  see DESIGN-SYSTEM); price delta shown as "+$35" or "Included". First value preselected only when its
  delta is 0; otherwise nothing preselected and the group is required.
- Step 6: add-ons as checkboxes, **none pre-ticked** (brief anti-goal); optional step (always complete).
- `PriceSummary`: lines from `priceSelection`, total; compact (footer) and expanded (sheet) variants;
  formats with the shell's `Intl.NumberFormat` helper (`shared/format.ts`). Steps 05 and 06 export it as
  their `Summary` (step contract, spec 16); spec 29 reuses it.

## Explicit non-scope

- Review and add to cart → spec 29.

## Reuse first

- Named in detail: shell contract (16), `priceSelection` (13), `design/v3/options.html`, `DESIGN-SYSTEM.md#component-conventions`
- spec 13 for every number on screen — no addition in components.

## Wiring

Real, used now: 16, 13. Tests: fixture catalog. Stubbed: none.

## Examples

| Selection | Expected summary | Why this row |
| --- | --- | --- |
| frame $120, lens $80, 1.67 (+$35) | lines 120 / 80 / 35, total $235.00 | normal |
| tint "Clear" delta 0 preselected | line "Included" | zero delta |
| tick then untick case (+$15) | total returns to previous value | toggle |
| option group with no zero-delta value | nothing preselected; Continue disabled | required |
| JPY shop | "¥1,500" (no decimals) | currency |

## Steps

1. `PriceSummary` + tests; 2. step 5; 3. step 6; 4. Examples tests.

## Self-check

1. No add-on is ever checked on first render (dark-pattern guard) — test it.
2. Swatches have text names, not colour alone.
3. UI checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary` passes: every Examples row is a case. [unit]
- [x] INV-4: components display `priceSelection` output only (`rg '\+ *[a-z]*[Pp]rice|toFixed' ` in these files finds nothing). [static]
- [x] INV-7: the raw-value `rg` finds nothing except the documented swatch custom-property assignment. [static]
- [x] INV-9: strings only from `strings.ts`. [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/28-step-options-addons.md` lists `PriceSummary` and the step modules. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 28 implemented by agy-6 in worktree `spec-28` (branch `spec/28-step-options-addons`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/configurator/src/price-summary/`:
  - `strings.ts`: Centralized user-visible strings for price summary (INV-9).
  - `resolve-frame-price.ts`: Resolves frame price from explicit props, configurator state, or DOM data attributes (`data-frame`, `data-product-json`), falling back to 0 minor units with catalog currency.
  - `price-summary.css`: Shadow DOM styles transcribed using only `--la-*` tokens without raw hex, rgb, or px values (INV-7).
  - `PriceSummary.tsx`: Preact component supporting compact (footer running total with line parts and live total amount) and expanded (sheet itemized breakdown list) variants. Formats prices using `formatMoney` without float arithmetic, displaying zero deltas as "Included" (INV-4).
  - `PriceSummary.test.tsx`: Unit tests verifying Row 1 (frame $120, lens $80, 1.67 (+$35) -> lines 120 / 80 / 35, total $235.00), Row 2 (zero delta renders "Included"), Row 5 (JPY currency ¥1,500 without decimals), expanded variant breakdown, missing catalog/selection safety, and DOM frame price resolution.
- **2026-11-08** — Landed `packages/configurator/src/steps/05-options/`:
  - `strings.ts`: Localized strings for step title, headings, price deltas, and "Included" (INV-9).
  - `options.css`: Shadow DOM styles for option fieldsets, choice cards, and swatch chips using closed `--la-*` token list (INV-7).
  - `OptionsStep.tsx`: Preact component rendering one radio group per option group in catalog order. Colour groups (`group.kind === "COLOR"` or options with swatch) render as swatches with text names and `--la-swatch-color` inline custom properties. Automatically preselects the first option value only when its delta is 0; otherwise leaves the group unselected and required.
  - `index.tsx`: Step module contract exporting `{ id: "options", titleKey, isComplete, isApplicable, Component, Summary: PriceSummary }`.
  - `options.test.tsx`: Unit tests verifying Row 2 preselection, Row 4 required unselected groups, Self-check 2 swatch text names, price delta formatting, selection replacement on click, and step contract exports.
- **2026-11-08** — Landed `packages/configurator/src/steps/06-add-ons/`:
  - `strings.ts`: Localized strings for step title, headings, price deltas, and "Included" (INV-9).
  - `add-ons.css`: Shadow DOM styles for add-on choice cards and checkbox indicators using `--la-*` tokens (INV-7).
  - `AddOnsStep.tsx`: Preact component rendering optional add-ons as checkbox cards in catalog order. Zero add-ons pre-ticked on first render (dark-pattern guard). Ticking and unticking dispatches `TOGGLE_ADDON`.
  - `index.tsx`: Step module contract exporting `{ id: "add-ons", titleKey, isComplete: () => true, isApplicable, Component, Summary: PriceSummary }`.
  - `add-ons.test.tsx`: Unit tests verifying Self-check 1 (no add-on checked on first render), Row 3 toggle behavior (tick then untick returns total), always-complete status, and price delta display.
- **2026-11-08** — Inventory fragment created at `specs/inventory/28-step-options-addons.md` documenting `price-summary`, `options-step`, and `addons-step`.
- **2026-11-08** — Sabotage checks verified and restored:
  1. In `OptionsStep.tsx`, changed `firstVal.priceDelta.amountMinor === 0` to `=== 99999` -> `OptionsStep (Step 5) > Row 2: preselects first value only when its delta is 0` turned RED (`AssertionError: expected "spy" to be called with arguments: [ { type: 'SET_OPTIONS', optionValueIds: ['val-150', 'val-clear', 'val-grey'] } ]`). Restored -> GREEN.
  2. In `PriceSummary.tsx`, changed `line.amount.amountMinor === 0` to `=== 99999` -> `PriceSummary > renders expanded variant with complete itemized breakdown` turned RED (`AssertionError: expected text to contain 'Included'`). Restored -> GREEN.
- **2026-11-08** — Self-checks verified:
  1. No add-on is ever checked on first render (dark-pattern guard): proven by `add-ons.test.tsx`.
  2. Swatches have text names, not colour alone: proven by `options.test.tsx`.
  3. UI checklist (`spec-quality.md` §8) holds: proper semantic roles (`radiogroup`, `checkbox`, `dialog`), `aria-live="polite"` running totals, focus-visible states with tokens, touch targets >= `--la-target`.
- **2026-11-08** — Gates verified:
  - `pnpm vitest run packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary`: 3 test files, 17 tests passed (0 failures).
  - INV-4: `rg '\+ *[a-z]*[Pp]rice|toFixed' packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary` found 0 matches.
  - INV-7: `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary --glob '!tokens.css'` found 0 matches.
  - INV-9: `rg '>[A-Za-z]' packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary --glob '*.tsx'` found 0 matches.
  - `pnpm test`: 61 test files, 1004 tests passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (`--max-warnings 0`).
  - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit, `configurator.js` 116588 B).
  - `git diff --check`: clean (exit 0).
- **2026-11-08** — Evidence (orchestro spec verify, tree f5c66418): install pass · typecheck pass · lint pass · build pass · test pass 1004/0/0
