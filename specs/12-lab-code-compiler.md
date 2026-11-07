# Spec 12 — Lab code compiler

**Status:** Not started
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

- [x] `pnpm vitest run packages/rx-core/src/lab-code` passes: every Examples row is a case; identity property test; a value containing `$&` is inserted literally. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/12-lab-code-compiler.md` lists `compileLabCode` and `validateTemplate`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 12 implemented by agy-4 in worktree `spec-12` (branch `spec/12-lab-code-compiler`). No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Built `packages/rx-core/src/lab-code/{types.ts,validator.ts,compiler.ts,index.ts}` and re-exported from `packages/rx-core/src/index.ts`.
- **2026-11-08** — Decisions: (1) `compileLabCode` accepts either template string or `Lens` object from Spec 03 for ergonomics across features. (2) `validateTemplate` returns `{ valid, errors, error?, tokens }` with closed error codes (`EMPTY_TEMPLATE`, `UNCLOSED_TOKEN`, `UNOPENED_TOKEN`, `MALFORMED_TOKEN`, `DUPLICATE_TOKEN`) and token objects with default values so spec 18 admin form can show inline validation and live preview. (3) Segment overrides replace whole dash-separated segments by position name (`material` -> first segment / segment 0, `lens_type` -> segment 1, `lens_color` -> segment 2, or explicit numeric index / position name). Overrides take precedence over token replacement targeting the same segment. (4) Template with no tokens compiles to itself for any selections. (5) Unknown token keys are reported in `warnings` as `UNKNOWN_TOKEN <key>`.
- **2026-11-08** — Self-check 1: Token values and override codes are inserted as plain strings during segment concatenation and never evaluated by regex replacers; values containing `$1`, `$&`, `$$`, `$'`, and `.` insert literally. Verified in unit tests.
- **2026-11-08** — Self-check 2: Override and token targeting the same segment — override wins. Tested with `material` segment overrides against token `material`, `lens_type` override against token `lens_type`, and segment index overrides.
- **2026-11-08** — Self-check 3: Parser checklist (`spec-quality.md` §8) checked and holds: deterministic compilation, graceful handling of empty inputs, throws clear error on malformed templates passed to compiler, duplicate token checks, unclosed/unopened bracket checks, 10,000-character long inputs, non-ASCII/unicode characters.
- **2026-11-08** — Sabotage: (1) disable segment override check (`false && overrideVal !== undefined`) → 7 tests red (`expected 'PO-58-NONE-NONE-00' to be 'PO-67-NONE-NONE-00'`), restored; (2) disable duplicate token check in `validator.ts` → 1 test red (`row 6: template with [a=X] twice`), restored.
- **2026-11-08** — Gates after last code change:
  - `pnpm vitest run packages/rx-core/src/lab-code` → `Test Files  1 passed (1)` / `Tests  30 passed (30)`
  - `pnpm test` → `Test Files  16 passed (16)` / `Tests  265 passed (265)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
- **2026-11-07** — Evidence (orchestro spec verify, tree 3995a640): install pass · typecheck pass · lint pass · build pass · test pass 265/0/0
