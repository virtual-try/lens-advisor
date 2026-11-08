# Spec 29 — Configurator step 7: review and add to cart (nested lines)

**Status:** Done
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

- [x] `pnpm vitest run packages/configurator/src/steps/07-review packages/configurator/src/cart` passes: every Examples row is a case, with the recorded fetch calls asserted in order. [unit]
- [x] INV-3: a test seeds Rx with distinctive values and asserts none reaches any cart call body when the setting is off. [unit]
- [x] INV-4: the button total comes from `priceSelection` (test changes an option and asserts the label). [unit]
- [x] INV-7: the raw-value `rg` finds nothing in these folders. [static]
- [x] INV-9: strings only from `strings.ts`. [static]
- [ ] On a dev store theme, the cart shows the frame with lens and options nested beneath it. [requires: Shopify dev store with the app block placed]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/29-step-review-add-to-cart.md` lists `addBundle` and the review step. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 29 implemented by agy-3 in worktree `spec-29` (branch `spec/29-step-review-add-to-cart`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/configurator/src/cart/`:
  - `add-bundle.ts`: `addBundle` function adding nested bundle lines via Shopify Cart AJAX API (`POST /cart/add.js`). Generates `bundleId` (`crypto.randomUUID`), adds frame line first, extracts frame line `key`, then adds child lines (lens, each option value with variant, each add-on with variant) with `parent_id = frameKey`. Lens line carries `_option_ids`, `_addon_ids`, `_rx_ref`, and prescription properties (`Prescription: "Prescription on file"` when `storeRxInOrder` is off, `_rx_od`/`_rx_os`/`_rx_pd` when on, per INV-3). Zero-delta options without variant (e.g. Clear tint) do not create a cart line; their ID is recorded in lens `_option_ids`. On any child failure (e.g. 422 sold out, 500, or network throw), rollback immediately removes frame line via `POST /cart/change.js` with `{ id: frameKey, quantity: 0 }`. Also exports `getCartEndpoint` (supporting `window.Shopify.routes.root`), `refreshCartOrRedirect` (dispatches theme's `cart:refresh` event or navigates to `/cart`), and `AddBundleError`.
  - `index.ts`: Barrel export for cart module.
  - `add-bundle.test.ts`: Unit tests covering all 7 Examples table cases with recorded fetch calls asserted in order, child line `parent_id` matching frame key, rollback on 422, rollback on network throw, INV-3 setting on/off, zero-price option handling, and cart refresh event dispatch.
- **2026-11-08** — Landed `packages/configurator/src/steps/07-review/`:
  - `strings.ts`: User-visible localized strings for review step headings, row labels, Rx descriptions, table headers, reassurance notice, error alerts, and "Add to cart — <total>" action (INV-9).
  - `review.css`: Shadow DOM styles transcribed using only `--la-*` tokens with zero raw hex, rgb, px, or ms design values (INV-7).
  - `ReviewStep.tsx`: Preact component rendering choices (Frame, Vision, Prescription, Lens, Options, Extras) with accessible Edit links (`GO_TO_STEP`), optician reassurance text, expanded `PriceSummary` breakdown, and primary "Add to cart — <total>" button derived from `priceSelection` (INV-4). Idempotent UI with disabled/busy state preventing double clicks. Displays error banner with Retry button on child failure.
  - `index.tsx`: Step module contract exporting `{ id: "review", titleKey: "review", isComplete: () => true, isApplicable: () => true, Component: ReviewStep }`.
  - `review.test.tsx`: Unit tests verifying rendering of all choices, button total dynamic derivation from `priceSelection`, Edit navigation to step 4 on Lens row with selection preserved, double-click prevention, INV-3 prescription table suppression when `storeRxInOrder` is off, and error alert with Retry on 422 child failure.
- **2026-11-08** — Inventory fragment created at `specs/inventory/29-step-review-add-to-cart.md` documenting `add-bundle` and `review-step`.
- **2026-11-08** — Sabotage checks verified and restored:
  1. In `add-bundle.ts`, changed `parent_id: frameLineKey` to `parent_id: selection.frameVariantId` -> `Spec 29 — addBundle > Row 1: all 200` turned RED (`AssertionError: expected 'var-frame-harlow' to be '445566:abcdef12345'`). Restored -> GREEN.
  2. In `add-bundle.ts`, commented out `rollbackFrame(fetchFn, changeUrl, frameLineKey)` -> `Spec 29 — addBundle > Row 3: child add returns 422` and `Self-check 2` turned RED (`AssertionError: expected calls to have length 3 but got 2`). Restored -> GREEN.
  3. In `ReviewStep.tsx`, changed button label to hardcoded `"Add to cart — $999.00"` -> `ReviewStep > renders all choices` and `INV-4 button total` turned RED (`Unable to find an element with the text: Add to cart — $250.00`). Restored -> GREEN.
- **2026-11-08** — Self-checks verified:
  1. The child POST sends `parent_id` as the frame line key from the response, not the variant id: proven by `add-bundle.test.ts`.
  2. Rollback runs on every child failure path, including a network throw: proven by `add-bundle.test.ts`.
  3. The button total equals `priceSelection(...).total` — no separate sum: proven by `review.test.tsx`.
  4. UI + api checklists (`spec-quality.md` §8) hold: proper semantic roles, accessible labels, loading/disabled state on submission, safe error mapping, zero inline JSX strings, zero raw token values.
- **2026-11-08** — Owner-gated check note (R7): The Done-when box `On a dev store theme, the cart shows the frame with lens and options nested beneath it` remains unticked because it requires a live Shopify development store with the app block placed (owner provides).
- **2026-11-08** — Gates verified:
  - `pnpm vitest run packages/configurator/src/steps/07-review packages/configurator/src/cart`: 2 test files, 18 tests passed (0 failures).
  - INV-3: `storeRxInOrder: false` verified with distinctive values (`-7.75`, `1.25`, `6.50`), confirming zero Rx numbers in cart payload or review DOM.
  - INV-4: `rg 'parseFloat|toFixed' packages/configurator/src/steps/07-review packages/configurator/src/cart` found 0 matches.
  - INV-7: `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' packages/configurator/src/steps/07-review packages/configurator/src/cart --glob '!tokens.css'` found 0 matches.
  - INV-9: `rg '>[A-Za-z]' packages/configurator/src/steps/07-review --glob '*.tsx'` found 0 matches.
  - `pnpm test`: 67 test files, 1173 tests passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (`eslint . --max-warnings 0`).
  - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit, `configurator.js` 135788 B, `loader.css` 3319 B).
  - `git diff --check`: clean (exit 0).
- **2026-11-08** — Evidence (orchestro spec verify, tree 57823b2e): install pass · typecheck pass · lint pass · build pass · test pass 1307/0/0
- **2026-11-08** — Fix round R1 addressing findings R1-F1 through R1-F9:
  - R1-F1: `rollbackFrame` returns boolean (`res.ok`) and surfaces distinct `ROLLBACK_FAILED` code with warning message when removal fails. Tested non-OK (500) and throwing `/cart/change.js`.
  - R1-F2: On `FRAME_RESPONSE_INVALID` or `FRAME_KEY_MISSING` after 200, re-reads `/cart.js` and rolls back newest frame line for variant by `_bundle_id`, reporting `rolledBack` truthfully. Tested both frame-failure paths and `UNKNOWN_LENS` rollback.
  - R1-F3: Pass `prescription` and `rxRef` only when `rxType !== "NON_PRESCRIPTION"`. Tested that no `_rx_*` properties reach cart call for non-prescription bundles.
  - R1-F4: Show `strings.rx.nonPrescription` for `NON_PRESCRIPTION` regardless of `storeRxInOrder`, and hide Edit button when Rx step does not apply. Tested with setting on and off.
  - R1-F5: Resolve Edit targets dynamically by step ID from registered steps list (never hard-coded numbers). Dropped frame "Change" button. Tested Edit link navigation with arbitrary step ordering.
  - R1-F6: Removed invented `cart:refresh`/`cart:updated` events and drawer selector guessing. Navigates to `/cart` reliably unless explicit theme hook is configured (`options.onCartUpdate` or `window.LensAdvisor.onCartUpdate`). Tested.
  - R1-F7: Disabled Add to cart button and displayed `strings.priceUnavailable` when total cannot be computed (no catalog, null frame price, `priceSelection` throws). Tested no-catalog, null frame price, and pricing error states.
  - R1-F8: Mapped `AddBundleError.code` to distinct localized sentences in `strings.ts` (frame failed, lenses failed and rolled back, rollback failed, network), with generic sentence fallback. Tested all 4 mappings.
  - R1-F9: Drove the real reducer in Row 7 test and asserted `GO_TO_STEP` preserves full selection.
  - Gates: `pnpm test` (67 test files, 1185 tests passed), `pnpm lint` (0 errors, 0 warnings), `pnpm typecheck` (pass), `pnpm build` (`loader.js` 1314 B, `configurator.js` 138423 B), `git diff --check` (clean).
