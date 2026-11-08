# Spec 12 — Lab code compiler

**Status:** Done
**Depends on:** Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/rx-core/src/lab-code/`, `specs/inventory/12-lab-code-compiler.md`
**Reuses:** `packages/rx-core/src/index.ts` (spec 03)
**Kind:** parser, logic
**Invariants:** —

## Goal

Compile the lab code for an order line from the base lens's template and the chosen upgrades, so one
lens template covers every material/tint/colour combination without a Shopify variant per combination
(blueprint: "Hierarchical Lab Metadata Override & Token Compiler").

## Scope

- Template grammar: literal text with tokens `[key=DEFAULT]`; key is `[a-z_]+`, default `[A-Z0-9]*`.
- An option value contributes either a **token** (`key`, `value`) that replaces `[key=…]`, or an
  **override code** that replaces a whole dash-separated segment by position name (`material` → the
  first segment). Override wins over token for the same segment.
- Unreplaced tokens fall back to their default. Unknown keys in option values are reported, not dropped
  silently: result is `{ code, warnings[] }`.
- `validateTemplate(text)` for the admin form (spec 18): malformed brackets, duplicate keys.

## Explicit non-scope

- Where the code is printed → spec 24.
- Editing templates in the admin → spec 18.

## Reuse first

- Named in detail: `Lens`, `OptionValue` types (spec 03)
- Spec 03 types only.

## Wiring

Real, used now: spec 03 types. Stubbed: none.

## Examples

Template `PO-58-[lens_type=NONE]-[lens_color=NONE]-00` (from the blueprint).

| Selections | Expected code | Why this row |
| --- | --- | --- |
| none | `PO-58-NONE-NONE-00` | defaults |
| tint `lens_type=POLR`, colour `lens_color=GREY` | `PO-58-POLR-GREY-00` | normal |
| material override `PO-67` | `PO-67-NONE-NONE-00` | override segment |
| token `lens_tint=PHOT` (unknown key) | `PO-58-NONE-NONE-00`, warning `UNKNOWN_TOKEN lens_tint` | unknown key |
| template `PO-[lens_type=NONE` | `validateTemplate` → `UNCLOSED_TOKEN` | malformed |
| template with `[a=X]` twice | `DUPLICATE_TOKEN a` | duplicate |
| empty template | `EMPTY_TEMPLATE` | invalid |

## Steps

1. Tokenizer + validator; 2. compiler; 3. every Examples row a test, plus a property test: a template
with no tokens compiles to itself for any selections.

## Self-check

1. Token values are never interpreted as regex (a value containing `$1` or `.` is inserted literally).
2. Override and token targeting the same segment — override wins, test it.
3. Parser checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/rx-core/src/lab-code` passes: every Examples row is a case; identity property test; a value containing `$&` is inserted literally. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/12-lab-code-compiler.md` lists `compileLabCode` and `validateTemplate`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
