# Spec 13 — Price calculation

**Status:** Done
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

- [x] `pnpm vitest run packages/rx-core/src/pricing` passes: every Examples row is a case; total == sum(lines) property test; order stability test. [unit]
- [x] INV-4: every amount asserted with `Number.isInteger`; `rg 'parseFloat|toFixed' packages/rx-core/src/pricing` finds nothing. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/13-pricing.md` lists `priceSelection`, `parseMoneyText`, `toShopifyDecimal`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 13 implemented by grok in worktree `spec-13` (branch `spec/13-pricing`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/rx-core/src/pricing/{errors,money-text,price-selection,index,pricing.test}.ts` and `specs/inventory/13-pricing.md`. Did not edit `packages/rx-core/src/index.ts` (owned by spec 03). Public exports are the pricing barrel, same pattern as specs 10 and 11.
- **2026-11-08** — Decisions: (1) `parseMoneyText` returns `{ ok: true, amountMinor } | { ok: false, error }` like `parseDiopterText`, so admin forms can branch. `priceSelection` and `toShopifyDecimal` throw `PricingError` (`code`, optional `itemId`). `UNKNOWN_ITEM` message is `UNKNOWN_ITEM <id>`. (2) Frame line label is `"Frame"`; the frame title is not an argument. Lens label is `lens.name`, option label is `value.label`, add-on label is `addOn.name`. Roles match bundle roles: `frame` | `lens` | `option` | `addon`. (3) Line order is catalog array order (option groups, then each group's values, then add-ons), not selection id order and not a re-sort by `position`. `position` stays the catalog service's job when it builds the arrays. (4) A comma is `MONEY_FORMAT`. "1,500" is either 1500 or 1.500, and guessing undercharges. A leading `+` or Unicode minus is accepted. `-0` becomes `0`. (5) `NEGATIVE_DELTA` applies only to a selected option delta. Lens and add-on amounts are the stored integers. An unselected foreign or negative row is ignored. Currency is checked before the sign, so a foreign negative delta is `CURRENCY_MISMATCH`. (6) Unknown ids are checked before any price is read. The first unknown wins: lens id, then `optionValueIds` as listed, then `addOnIds` as listed. A repeated id is one line. A duplicated catalog id uses the first row. (7) Minor-unit scale is `Intl.NumberFormat("en", { style: "currency" }).resolvedOptions().maximumFractionDigits` (USD 2, JPY 0, KWD 3). That call reads the exponent; it does not format a display string (spec 16). Extra fractional digits are `MONEY_PRECISION` and are not rounded. (8) `rxType` is not consulted. No `lensId` means no lens line, which is the NON_PRESCRIPTION row.
- **2026-11-08** — Sabotage, then restored: `totalMinor = next + 1` → `Tests  13 failed | 19 passed (32)`, including the 20000/29000 rows and the 200-selection property. Disabled the fractional-digit check → `Tests  3 failed | 29 passed (32)` (`35.555` USD, `15.5` JPY, `1.5000` KWD came back `MONEY_FORMAT`).
- **2026-11-08** — Self-check 1: no float arithmetic. Amounts are integer minor units. `rg 'parseFloat|toFixed' packages/rx-core/src/pricing` exits 1 with no output. Success tests assert `Number.isInteger` on every line and the total, including `0.1` → 10 and `1.10` → 110.
- **2026-11-08** — Self-check 2: reversed option ids and reversed add-on ids return the same lines. The 200-selection property test shuffles ids and asserts the lines match. A fixture whose `position` values disagree with array order still follows the array.
- **2026-11-08** — Self-check 3: logic checklist holds. Examples rows are tests. Empty input is the frame line alone. A single zero-delta option is its own line. Two add-ons with the same price stay in catalog order (tie). Output is deterministic. Units are integer minor units; extra fraction digits are rejected, not rounded.
- **2026-11-08** — Gates after the last code change (`maximumFractionDigits` narrowed for tsc):
  - `pnpm test` includes `packages/rx-core/src/pricing/pricing.test.ts (33 tests)` → `Test Files  18 passed (18)` / `Tests  312 passed (312)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
  - `git diff --check` exit 0
- **2026-11-07** — Evidence (orchestro spec verify, tree 799888aa): install pass · typecheck pass · lint pass · build pass · test pass 312/0/0
