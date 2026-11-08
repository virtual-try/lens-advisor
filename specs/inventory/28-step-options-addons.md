# Inventory fragment — Spec 28 (Configurator steps 5–6: options, add-ons and price summary)

### `price-summary`
`packages/configurator/src/price-summary/PriceSummary.tsx` & `packages/configurator/src/price-summary/index.ts` — Preact component for displaying price breakdowns and running totals calculated via `priceSelection(selection, catalog, framePrice)` from `packages/rx-core/src/pricing/`. Supports `compact` (footer running total with itemized lines and live total amount) and `expanded` (sheet / review itemized list) variants. Resolves frame price from explicit props, parsed product data, or active mount `data-product-json`, returning `null` if unavailable. Formats integer minor units via `formatMoney` with zero-delta values displayed as "Included". Reused by step 5, step 6, step 7 (review), and footer.
**Use instead of:** Writing custom price calculators or duplicating price breakdown display logic.
**Added by:** spec 28.

### `options-step`
`packages/configurator/src/steps/05-options/index.tsx` & `packages/configurator/src/steps/05-options/OptionsStep.tsx` — Configurator Step 5 module exporting `{ id: "options", titleKey, isComplete, isApplicable, Component, Summary: PriceSummary }`. Renders one radio group per option group in catalog order. Colour groups (`group.kind === "COLOR"` or options with `swatch`) render as swatches with visible text names and `--la-swatch-color` inline custom properties. Other groups render as choice cards. Price deltas render as `+${price}` or "Included". Automatically preselects the first option value only when its delta is 0; otherwise leaves the group unselected and enforces group completion before Continue is enabled.
**Use instead of:** Hand-crafted option group pickers or non-token swatch components.
**Added by:** spec 28.

### `addons-step`
`packages/configurator/src/steps/06-add-ons/index.tsx` & `packages/configurator/src/steps/06-add-ons/AddOnsStep.tsx` — Configurator Step 6 module exporting `{ id: "add-ons", titleKey, isComplete, isApplicable, Component, Summary: PriceSummary }`. Renders optional add-ons as checkbox choice cards in catalog order. Zero add-ons are pre-ticked on first render (dark-pattern guard). Ticking and unticking add-ons toggles their IDs in `selection.addOnIds`, updating the running price summary. Always complete (`isComplete = () => true`).
**Use instead of:** Custom add-on toggles or pre-selected add-on checkboxes.
**Added by:** spec 28.
