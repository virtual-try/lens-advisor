# Spec 03 — rx-core domain types and schemas

**Status:** Not started
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

Formatter: two decimals, explicit `+` on positives, `PL` for zero SPH (plano).
Properties keys exact. Axis is zero-padded to three digits. Dual PD is `od/os`.
Diopters are integer hundredths; money is integer minor units. Currency is an
ISO-4217 code from `Intl.supportedValuesOf("currency")` (uppercase). Tie does
not apply: nothing here ranks or picks among equals.

`_option_ids` and `_addon_ids` are JSON arrays of strings. A comma, quote,
empty-looking, or non-ASCII id round-trips. The reader never throws. A missing
key is omitted. Text that is not a JSON array of strings is omitted.

Normalized snapshot — the `x` in `read(build(x)) == x`:

- `role` and `bundleId` copy through.
- `itemId` is kept only when `role` is not `frame` and it was set.
- On a lens line, `optionIds` and `addonIds` are arrays (omitted input becomes `[]`), order kept. Other roles omit both.
- `rxRef` is kept only on a lens line when set.
- `storeRxInOrder` is true only for a lens line whose input flag is true. On frame, option, and addon it is false.
- `prescriptionOnFile` is true only for a lens line whose input flag is false.
- `formattedRx` is set only for a lens line with the flag on, from `formatEye` / `formatPd` when `prescription` is present, otherwise from input `formattedRx`. The typed prescription is not part of the snapshot.

| Input | Expected | Why this row |
| --- | --- | --- |
| `formatDiopter(-225)` | `"-2.25"` | normal |
| `formatDiopter(25)` | `"+0.25"` | positive sign shown |
| `formatDiopter(0)` | `"PL"` | plano boundary |
| `formatPd({single: 635})` | `"63.5"` | tenths |
| bundle props, `storeRxInOrder=false`, Rx SPH −2.25 | no property value contains `"2.25"`; `Prescription: "Prescription on file"` | INV-3 |
| bundle props, `storeRxInOrder=true` | every Rx key starts with `_` | INV-3 |
| catalog JSON with `amountMinor: 12.5` | schema rejects | INV-4 float money |
| `{ amountMinor: 100, currency: "LOL" }` | schema rejects | INV-4 unknown ISO-4217 code |
| prescription body with `sph: -2.25` (float) | schema rejects | INV-5 |
| `readBundleProperties({})` | `{ storeRxInOrder: false, prescriptionOnFile: false }`, no throw | empty input |
| lens line, `optionIds: ["only-one"]`, `addonIds: []` | read `optionIds` is `["only-one"]`, `addonIds` is `[]` | single item |
| lens line `optionIds` `["opt,a", "say\"hi\"", "透镜", " ", "", ","]` | read returns the same ids; the stored value is that JSON array | hostile and non-ASCII ids |
| whitespace-only `_bundle_role`, `_option_ids`, `_addon_ids`, `_bundle_id` `"   "` | no throw; role and id lists omitted; `bundleId` is `"   "` | whitespace-only reader input |
| 10 000 character `_bundle_id`, 10 000 character id in `_option_ids`, 10 000 character non-ASCII `_item_id` | no throw; those values come back | very long |
| `_bundle_id` `"束-α"`, `_item_id` `"🙂透镜"`, role `lens` | no throw; those strings come back | non-ASCII reader input |
| frame line, `storeRxInOrder` true, with a prescription | read `storeRxInOrder` false, `prescriptionOnFile` false, no `formattedRx` | normalized: flag does not apply off the lens line |
| lens line, `storeRxInOrder` false, with a prescription | read `storeRxInOrder` false, `prescriptionOnFile` true, no `formattedRx` | normalized: Rx stays off the line |
| 200 generated bundles, including hostile ids | `read(build(x))` equals the normalized snapshot | property round-trip |

## Steps

1. Write the schemas, infer the types, export from `index.ts` (the package's only barrel).
2. Write the formatters and the bundle-properties builder/reader.
3. Tests: every Examples row; property test over 200 generated bundles that `readBundleProperties(build(x))` equals the normalized snapshot in Examples.

## Self-check

1. No `number` that means money or diopters without its unit in the type or name.
2. INV-3: with the setting off, scan *every* property value for any formatted Rx number.
3. The reader tolerates missing optional keys (a frame line has no `_rx_ref`).
4. Logic/parser checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run packages/rx-core/src/cart/bundle-properties.test.ts` passes: every Examples row is a case; a property test round-trips 200 generated bundles. [unit]
- [x] `pnpm vitest run packages/rx-core/src/schemas` passes: each schema rejects float money and float diopters and accepts a valid fixture. [unit]
- [x] INV-3: a test seeds Rx with distinctive values and asserts none appears in any property value when the setting is off. [unit]
- [x] INV-4: `Money.amountMinor` is integer-validated; test with `12.5` rejects. [unit]
- [x] INV-5: diopter fields are integer-validated; test with `-2.25` rejects. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/03-rx-core-contracts.md` lists the exported types, schemas and helpers. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-07** — Spec 03 implemented by grok in worktree `spec-03` (branch `spec/03-rx-core-contracts`). No git writes (lead commits). GitHub issue skipped: dispatch forbids git writes.
- **2026-11-07** — Landed `packages/rx-core/src/{types,schemas,format,cart,index.ts}`. Types are inferred from zod schemas (one source). `Diopter` / `Axis` / `PdTenthsMm` are named integer types; `Money.amountMinor` is `z.number().int()`. Catalog DTOs nest lenses in groups and option values in groups; storefront `Lens`/`AddOn` require `shopifyVariantId`.
- **2026-11-07** — Decisions: (1) `buildBundleLineProperties` takes one input object so role-specific fields (`itemId`, `optionIds`, `addonIds`, `prescription`) fit without an unstable positional list. (2) `formatAxis` zero-pads to three digits (`090`) — spec gave no example. (3) Dual PD formats as `od/os` (`32.0/31.5`). (4) `_rx_od`/`_rx_os`/`_rx_pd` are written only on the lens line when `storeRxInOrder` is true; the visible `Prescription` key is written only when the setting is off and is always `"Prescription on file"`. (5) No `fast-check` (package.json owned by spec 01); 200-bundle round-trip uses a deterministic generator. (6) Round-trip is `build(parsedToBuildInput(read(build(x)))) == build(x)` for 200 generated inputs.
- **2026-11-07** — Self-check 1: no money/diopter `number` without unit in the type or name. Format params are `hundredths` (`Diopter`), `axisDegrees` (`Axis`), `tenthsMm` (`PdTenthsMm`). `rg 'parseFloat|toFixed' packages/rx-core/src` finds nothing. Formatters use integer split (`trunc` / `%`), not floats.
- **2026-11-07** — Self-check 2 / INV-3: distinctive Rx SPH −7.75 / CYL −1.25 × 137 ADD +2.50 / OS −3.25 / +0.75 × 42 / PD 64.5; every property value scanned. Sabotage: write `formatEye(od)` into a `_leak` key when the setting is off → red (`expected '-7.75/-1.25x137 ADD +2.50' not to contain '7.75'`); restored.
- **2026-11-07** — Self-check 3: reader returns `rxRef`/`itemId` undefined for a frame line; empty / 10k-char / non-ASCII maps do not throw.
- **2026-11-07** — Self-check 4: logic/parser checklist — Examples rows are tests; 200-bundle round-trip property test; hostile reader input does not throw; builder is deterministic; units are integer hundredths / tenths.
- **2026-11-07** — Gates after last code change:
  - `pnpm vitest run packages/rx-core/src/cart/bundle-properties.test.ts` → `Tests  11 passed (11)`
  - `pnpm vitest run packages/rx-core/src/schemas` → `Tests  15 passed (15)`
  - `pnpm test` → `Test Files  8 passed (8)` / `Tests  56 passed (56)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
- **2026-11-07** — Evidence (orchestro spec verify, tree b657bd74): install pass · typecheck pass · lint pass · build pass · test pass 116/0/0
- **2026-11-07** — Fix round (accepted R1). `_option_ids` / `_addon_ids` are JSON arrays, so comma, quote, non-ASCII, and empty-looking ids round-trip. `iso4217CurrencySchema` accepts only codes from `Intl.supportedValuesOf("currency")`. `read(build(x))` is compared to the normalized snapshot in Examples over 200 generated bundles. Float rejection is one case per money and diopter field on every exported schema that has one. Inventory names all 58 root exports. Examples gained empty input, single item, hostile ids, whitespace-only, very long, and non-ASCII reader rows; tie does not apply. Supersedes the earlier round-trip decision that compared `build(parsedToBuildInput(read(build(x))))` to `build(x)`.
- **2026-11-07** — Sabotage, then restored: comma-join ids → hostile-id test and the 200-bundle test red; drop the ISO-4217 refine → both `LOL` tests red; reader sets `storeRxInOrder` for any role → frame-line test red; `addMin: z.number()` → the `addMin` float cases red.
- **2026-11-07** — Gates after the last code change, from `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build`:
  - `packages/rx-core/src/cart/bundle-properties.test.ts (19 tests)`
  - `packages/rx-core/src/schemas/schemas.test.ts (66 tests)`
  - `pnpm test` → `Test Files  8 passed (8)` / `Tests  115 passed (115)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
