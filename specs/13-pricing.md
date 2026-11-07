# Spec 13 — Price calculation

**Status:** Not started
**Depends on:** Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/rx-core/src/pricing/`, `specs/inventory/13-pricing.md`
**Reuses:** `packages/rx-core/src/index.ts` (spec 03)
**Kind:** logic
**Invariants:** INV-4

## Goal

One function that turns a selection plus catalog into a priced breakdown — frame, lens, each option, each
add-on, total — used by the running price summary (28), the review step (29) and the admin preview.

## Scope

- `priceSelection(selection, catalog, framePrice) → { lines: [{ role, label, amount }], total }`.
- All amounts `Money`; all in the frame's currency. A catalog price in another currency is an error
  (`CURRENCY_MISMATCH`), not a conversion.
- Option price deltas may be zero or positive; negative deltas are rejected (`NEGATIVE_DELTA`).
- Unknown ids in the selection → `UNKNOWN_ITEM` error naming the id.
- Lines in fixed order: frame, lens, options (by option group order), add-ons (by catalog order).
- `parseMoneyText(text, currency)` → minor units or `MONEY_FORMAT`/`MONEY_PRECISION` error, using the
  currency's minor-unit digits (USD 2, JPY 0, KWD 3); used by the admin forms (18, 19). And
  `toShopifyDecimal(minor, currency)` → `"80.00"` string for the Admin API (17).

## Explicit non-scope

- Display formatting → spec 16 (`shared/format.ts`, `Intl.NumberFormat`).
- Discounts, tax, shipping → Shopify checkout (spec 00, out of MVP).

## Reuse first

- Named in detail: `Money`, `Selection`, catalog DTO types (spec 03)
- Spec 03 `Money` and schemas. Do not add a second money type.

## Wiring

Real, used now: spec 03. Stubbed: none.

## Examples

Minor units, USD unless stated.

| Selection | Expected total | Why this row |
| --- | --- | --- |
| frame 12000 + lens 8000 | 20000 | normal |
| + material 1.67 (+3500) + polarized (+4000) + case (+1500) | 29000 | full |
| option delta 0 | line present, amount 0 | zero |
| lens priced in EUR, frame USD | `CURRENCY_MISMATCH` | invalid |
| option id not in catalog | `UNKNOWN_ITEM <id>` | invalid |
| NON_PRESCRIPTION, no lens | frame + add-ons only | boundary |
| `parseMoneyText("35.5","USD")` / `("0.1","USD")` | 3550 / 10 | float trap |
| `parseMoneyText("35.555","USD")` | `MONEY_PRECISION` | precision |
| `parseMoneyText("1500","JPY")` / `("15.5","JPY")` | 1500 / `MONEY_PRECISION` | zero-decimal currency |
| `toShopifyDecimal(8000,"USD")` / `(1500,"JPY")` | `"80.00"` / `"1500"` | Admin API format |
| `parseMoneyText("","USD")`, `"abc"`, `"1e3"` | `MONEY_FORMAT` | hostile |

## Steps

1. Implement; 2. every Examples row a test; 3. property test: total == sum(lines) for generated selections.

## Self-check

1. No float anywhere (INV-4).
2. Line order is stable when the selection lists ids in a different order.
3. Logic checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/rx-core/src/pricing` passes: every Examples row is a case; total == sum(lines) property test; order stability test. [unit]
- [ ] INV-4: every amount asserted with `Number.isInteger`; `rg 'parseFloat|toFixed' packages/rx-core/src/pricing` finds nothing. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/13-pricing.md` lists `priceSelection`, `parseMoneyText`, `toShopifyDecimal`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
