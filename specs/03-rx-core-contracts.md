# Spec 03 — rx-core domain types and schemas

**Status:** Done
**Depends on:** Spec 01
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `packages/rx-core/src/types/`, `packages/rx-core/src/schemas/`, `packages/rx-core/src/cart/bundle-properties.ts`, `packages/rx-core/src/cart/bundle-properties.test.ts`, `packages/rx-core/src/format/`, `packages/rx-core/src/index.ts`, `specs/inventory/03-rx-core-contracts.md`
**Reuses:** `packages/rx-core/package.json` (spec 01), `ARCHITECTURE.md#data-model`
**Kind:** logic, parser
**Invariants:** INV-3, INV-4, INV-5

## Goal

Land the shared contract every other spec builds against: the domain types, the zod schemas for every
payload that crosses a boundary, the diopter/money formatters, and the cart bundle line-property
contract. After this merges, server, storefront and cart-function specs fan out in parallel.

## Scope

- **Types** (intent level — names are the coder's, units are not):
  - `Diopter` = signed integer hundredths; `Axis` = integer 1–180; `PdTenthsMm` = integer tenths of a mm.
  - `Prescription`: per eye (OD right, OS left) `{ sph, cyl?, axis?, add? }`, PD as single or dual,
    optional notes; `RxType` enum: `SINGLE_VISION`, `PROGRESSIVE`, `READING`, `NON_PRESCRIPTION`.
  - `RxLimits`: inclusive `sphMin/sphMax`, `cylMin/cylMax`, optional `addMin/addMax`, allowed `RxType[]`.
  - Catalog DTOs as the storefront sees them: `LensGroup`, `Lens` (with `RxLimits`, price, Shopify
    variant id, lab-code template), `OptionGroup` (kind: `MATERIAL`, `TINT_TYPE`, `COLOR`) with
    `OptionValue` (price delta, token key/value or override code), `AddOn`.
  - `Money` = `{ amountMinor: integer, currency: ISO-4217 }` (INV-4).
  - `Selection`: frame variant, rxType, prescription ref, lens id, option value ids, add-on ids.
- **Schemas** (zod) for: catalog response, prescription submit body, upload-url request, selection.
  Types are inferred from the schemas — one source.
- **Format**: `formatDiopter(-225) → "-2.25"`, `formatDiopter(0) → "PL"` (plano, ruling below),
  `formatAxis`, `formatPd`. Parsing text into these lives in spec 10, not here.
- **Cart lines are Shopify nested cart lines** (spec 00): the frame is the parent line; the lens, each priced
  option and each add-on are child lines added with `parent_id` (Cart AJAX API). Shopify removes children
  with their parent, so there is no quantity-sync code.
- **Bundle properties**: `buildBundleLineProperties(role, bundleId, rxRef, rxSummary, storeRxInOrder)`
  and its reader. Keys: `_bundle_id`, `_bundle_role` (`frame` | `lens` | `option` | `addon`), `_item_id`
  (catalog row id on lens/option/addon lines), `_option_ids` and `_addon_ids` on the lens line (every chosen
  id, including zero-price options that have no line of their own — how spec 23 rebuilds the selection), `_rx_ref`;
  visible key `Prescription` = "Prescription on file" when `storeRxInOrder` is off (INV-3); when on,
  Rx values under `_rx_od`, `_rx_os`, `_rx_pd` formatted by the formatter.

## Explicit non-scope

- Parsing shopper text into diopters, cross-field Rx rules → spec 10.
- The limits check → spec 11. Lab-code compilation → spec 12. Price totals → spec 13.
- Prisma models → spec 02 (it mirrors these names; neither imports the other).

## Reuse first

- Named in detail: `packages/rx-core/` skeleton and Vitest config (spec 01), `ARCHITECTURE.md#data-model`
- This spec builds the first of its kind; nothing exists to reuse beyond spec 01's package skeleton.
- Every later spec imports types from `packages/rx-core` — no spec redeclares a `Prescription` type.

## Wiring

Real, used now: zod (installed by spec 01).
Stubbed: none.

## Examples

Formatter: two decimals, explicit `+` on positives, `PL` for zero SPH (plano). Properties keys exact.

| Input | Expected | Why this row |
| --- | --- | --- |
| `formatDiopter(-225)` | `"-2.25"` | normal |
| `formatDiopter(25)` | `"+0.25"` | positive sign shown |
| `formatDiopter(0)` | `"PL"` | plano boundary |
| `formatPd({single: 635})` | `"63.5"` | tenths |
| bundle props, `storeRxInOrder=false`, Rx SPH −2.25 | no property value contains `"2.25"`; `Prescription: "Prescription on file"` | INV-3 |
| bundle props, `storeRxInOrder=true` | every Rx key starts with `_` | INV-3 |
| catalog JSON with `amountMinor: 12.5` | schema rejects | INV-4 float money |
| prescription body with `sph: -2.25` (float) | schema rejects | INV-5 |

## Steps

1. Write the schemas, infer the types, export from `index.ts` (the package's only barrel).
2. Write the formatters and the bundle-properties builder/reader.
3. Tests: every Examples row; round-trip `readBundleProperties(build(x)) == x` as a property test.

## Self-check

1. No `number` that means money or diopters without its unit in the type or name.
2. INV-3: with the setting off, scan *every* property value for any formatted Rx number.
3. The reader tolerates missing optional keys (a frame line has no `_rx_ref`).
4. Logic/parser checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/rx-core/src/cart/bundle-properties.test.ts` passes: every Examples row is a case; a property test round-trips 200 generated bundles. [unit]
- [ ] `pnpm vitest run packages/rx-core/src/schemas` passes: each schema rejects float money and float diopters and accepts a valid fixture. [unit]
- [ ] INV-3: a test seeds Rx with distinctive values and asserts none appears in any property value when the setting is off. [unit]
- [ ] INV-4: `Money.amountMinor` is integer-validated; test with `12.5` rejects. [unit]
- [ ] INV-5: diopter fields are integer-validated; test with `-2.25` rejects. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/03-rx-core-contracts.md` lists the exported types, schemas and helpers. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
