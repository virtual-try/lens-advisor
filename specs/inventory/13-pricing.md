# Inventory fragment — Spec 13 (Price calculation)

### `price-selection`
`packages/rx-core/src/pricing/price-selection.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `priceSelection(selection, catalog, framePrice)` returns `{ lines, total }`. Each line is `{ role, label, amount }` with `role` `frame` | `lens` | `option` | `addon` and `amount` a `Money`. Order is catalog array order: frame, lens (only when `lensId` is set), option values walked `optionGroups` → `values`, add-ons walked `addOns`. Selection id order does not change the lines. A repeated id is one line. The first catalog row wins when an id is duplicated. The frame line label is `"Frame"` (the frame title is not an input). Throws `PricingError`: `UNKNOWN_ITEM` (message `UNKNOWN_ITEM <id>`, `itemId` set; first unknown wins: lens, then option ids as listed, then add-on ids as listed), `CURRENCY_MISMATCH` (selected row currency ≠ frame currency; checked before the sign), `NEGATIVE_DELTA` (selected option delta < 0). A zero delta is a line with amount 0. `rxType` is not consulted.
**Use instead of:** summing prices in the configurator, the review step, or the admin preview.
**Added by:** spec 13.

### `parse-money-text`
`packages/rx-core/src/pricing/money-text.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `parseMoneyText(text, currency)` returns `{ ok: true, amountMinor }` or `{ ok: false, error: "MONEY_FORMAT" | "MONEY_PRECISION" }`. Minor-unit scale comes from `Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits` (USD 2, JPY 0, KWD 3). Digits are walked as integers; extra fractional digits are `MONEY_PRECISION` and are not rounded. A comma, exponent, hex prefix, unknown currency, or unsafe integer is `MONEY_FORMAT`. A leading `+` or `-` (including U+2212) is accepted; `-0` becomes `0`.
**Use instead of:** `parseFloat`, `Number(text) * 100`, or a second money parser in the admin forms.
**Added by:** spec 13.

### `to-shopify-decimal`
`packages/rx-core/src/pricing/money-text.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `toShopifyDecimal(amountMinor, currency)` returns the Admin API decimal string (`8000` USD → `"80.00"`, `1500` JPY → `"1500"`, `1500` KWD → `"1.500"`). Integer split only. A non-integer amount or unknown currency throws `PricingError` `MONEY_FORMAT`.
**Use instead of:** `toFixed` or float division when setting a Shopify variant price.
**Added by:** spec 13.

### `pricing-error`
`packages/rx-core/src/pricing/errors.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `PRICING_ERROR_CODES` and `PricingError` (`code`, optional `itemId`). Codes: `CURRENCY_MISMATCH`, `NEGATIVE_DELTA`, `UNKNOWN_ITEM`, `MONEY_FORMAT`, `MONEY_PRECISION`.
**Use instead of:** ad-hoc price error strings.
**Added by:** spec 13.
