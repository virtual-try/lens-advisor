# Spec 28 — Configurator steps 5–6: options, add-ons and price summary

**Status:** Done
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

- [ ] `pnpm vitest run packages/configurator/src/steps/05-options packages/configurator/src/steps/06-add-ons packages/configurator/src/price-summary` passes: every Examples row is a case. [unit]
- [ ] INV-4: components display `priceSelection` output only (`rg '\+ *[a-z]*[Pp]rice|toFixed' ` in these files finds nothing). [static]
- [ ] INV-7: the raw-value `rg` finds nothing except the documented swatch custom-property assignment. [static]
- [ ] INV-9: strings only from `strings.ts`. [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/28-step-options-addons.md` lists `PriceSummary` and the step modules. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
