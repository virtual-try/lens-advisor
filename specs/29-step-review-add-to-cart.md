# Spec 29 — Configurator step 7: review and add to cart (nested lines)

**Status:** Not started
**Depends on:** Spec 13, Spec 16, Spec 28
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `packages/configurator/src/steps/07-review/`, `packages/configurator/src/cart/`, `specs/inventory/29-step-review-add-to-cart.md`
**Reuses:** `packages/rx-core/src/cart/bundle-properties.ts` (spec 03), `packages/rx-core/src/pricing/` (spec 13), `packages/configurator/src/price-summary/` (spec 28), `packages/configurator/src/shell/` (spec 16), `design/v3/review.html`, `DESIGN-SYSTEM.md#component-conventions`
**Kind:** ui, api
**Invariants:** INV-3, INV-4, INV-7, INV-9

## Goal

The shopper sees everything they chose — frame, Rx summary, lens, options, add-ons, total — edits any part,
and adds it to the cart in one action as a frame line with the lens, priced options and add-ons nested under it.

## Scope

- Review: one row per choice with an "Edit" link back to that step; Rx summary shows "Prescription on file"
  plus type (no values when `storeRxInOrder` is off — the same rule as the cart, INV-3); expanded
  `PriceSummary`; one primary button "Add to cart — $235.00".
- `cart/add-bundle.ts`: generate `bundleId` (`crypto.randomUUID`); POST `/cart/add.js` with the frame first,
  read its line `key`, then POST the children (lens, each option value with a variant, each add-on) with
  `parent_id` = that key, properties from `buildBundleLineProperties` (lens line carries `_option_ids`,
  `_addon_ids`, `_rx_ref`). Uses `window.Shopify.routes.root` for the cart URL.
- Failure after the frame was added (child POST fails) → remove the frame line (`/cart/change.js`,
  quantity 0, which removes any children) and show an error with Retry; never leave a half bundle.
- Success: close the sheet, dispatch the theme's cart refresh event if present, else go to `/cart`.
  The `design/v3/review.html` cart drawer is the reference for how the nested lines read; the theme
  renders the real cart.

## Explicit non-scope

- Cart Transform / merged bundle line → post-MVP (spec 00). Theme cart templates → theme's own.
- Reading the order back → spec 23.

## Reuse first

- Named in detail: `buildBundleLineProperties` (03), `priceSelection` (13), `PriceSummary` (28), shell contract + reducer (16), `design/v3/review.html` (review + cart drawer), `DESIGN-SYSTEM.md#component-conventions`
- spec 03 property builder — no hand-written `_bundle_*` keys. spec 13 for the button total.

## Wiring

Real, used now: Cart AJAX API at runtime; 03, 13, 16, 28. Tests: fake `fetch` recording every cart call.
Stubbed: none.

## Examples

| Cart responses | Expected calls / UI | Why this row |
| --- | --- | --- |
| all 200 | add frame → add [lens, 1.67, case] with `parent_id` = frame key; sheet closes | normal |
| tint "Clear" (delta 0) chosen | no line for it; its id is in the lens line `_option_ids` | zero-price option |
| child add returns 422 (sold out) | `/cart/change.js` frame qty 0; error "Couldn't add your lenses" + Retry | rollback |
| `storeRxInOrder` off | no property value contains a formatted Rx number | INV-3 |
| `storeRxInOrder` on | `_rx_od`/`_rx_os`/`_rx_pd` present on the lens line only | setting |
| double-click the button | one bundle added (button disabled while pending) | idempotent UI |
| Edit on "Lens" row | goes to step 4 with the selection kept | edit |

## Steps

1. `add-bundle.ts` + tests on a fake fetch; 2. review step; 3. Examples tests.

## Self-check

1. The child POST sends `parent_id` as the frame line **key** from the response, not the variant id.
2. Rollback runs on every child failure path, including a network throw.
3. The button total equals `priceSelection(...).total` — no separate sum.
4. UI + api checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/configurator/src/steps/07-review packages/configurator/src/cart` passes: every Examples row is a case, with the recorded fetch calls asserted in order. [unit]
- [ ] INV-3: a test seeds Rx with distinctive values and asserts none reaches any cart call body when the setting is off. [unit]
- [ ] INV-4: the button total comes from `priceSelection` (test changes an option and asserts the label). [unit]
- [ ] INV-7: the raw-value `rg` finds nothing in these folders. [static]
- [ ] INV-9: strings only from `strings.ts`. [static]
- [ ] On a dev store theme, the cart shows the frame with lens and options nested beneath it. [requires: Shopify dev store with the app block placed]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/29-step-review-add-to-cart.md` lists `addBundle` and the review step. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
