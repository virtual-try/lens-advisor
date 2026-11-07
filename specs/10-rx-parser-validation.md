# Spec 10 — Rx parser and validation

**Status:** Not started
**Depends on:** Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/rx-core/src/rx/parse.ts`, `packages/rx-core/src/rx/parse.test.ts`, `packages/rx-core/src/rx/validate.ts`, `packages/rx-core/src/rx/validate.test.ts`, `specs/inventory/10-rx-parser-validation.md`
**Reuses:** `packages/rx-core/src/index.ts` (spec 03), `packages/rx-core/src/format/` (spec 03)
**Kind:** parser, logic
**Invariants:** INV-5

## Goal

Turn what a shopper types into a `Prescription` in integer units, and report every field error with a
machine code the UI can map to a message. The same functions run in the browser (spec 26) and on the
server (spec 22).

## Scope

- `parseDiopterText(text)`: accepts `-2.25`, `−2.25` (Unicode minus), `+0.50`, `2.5`, `.75`, `PL`,
  `plano`, `0`, `-2,25` (comma decimal). Rejects non-quarter steps and junk.
- `parseAxis`, `parsePd` (single 50.0–80.0 mm, or dual 25.0–40.0 mm per eye, 0.5 mm steps).
- `validatePrescription(rx, rxType)` → list of `{ field, eye?, code }`:
  - SPH −20.00..+20.00, CYL −6.00..+6.00, both in 0.25 steps.
  - AXIS required when CYL ≠ 0; AXIS must be absent/ignored when CYL = 0.
  - ADD required for `PROGRESSIVE` and `READING`, +0.75..+3.50; ignored for `SINGLE_VISION`.
  - `NON_PRESCRIPTION`: prescription must be empty.
  - Mixed CYL sign between eyes is allowed (no transposition here — that is spec 11's concern).
- Codes are a closed enum exported from this file (`SPH_RANGE`, `SPH_STEP`, `AXIS_REQUIRED`, …).

## Explicit non-scope

- Lens availability against limits → spec 11.
- Error message copy → spec 26's `strings.ts`.
- Reading values from an uploaded image → out of MVP, spec 00 (AI OCR, see `README.md`).

## Reuse first

- Named in detail: `Prescription`, `RxType`, `Diopter` types and `formatDiopter` (spec 03)
- Use spec 03's types and formatter; do not add a second diopter formatter here.

## Wiring

Real, used now: spec 03 types. Stubbed: none.

## Examples

Hundredths of a diopter. Steps of 25. Ranges inclusive. Whitespace trimmed. Comma accepted as decimal.

| Input | Expected | Why this row |
| --- | --- | --- |
| `"-2.25"` | `-225` | normal |
| `"−2.25"` (U+2212) | `-225` | Unicode minus |
| `"-2,25"` | `-225` | comma decimal |
| `"PL"` / `"plano"` / `"0"` | `0` | plano |
| `"2.3"` | error `SPH_STEP` | not a quarter step |
| `"+20.00"` / `"+20.25"` | `2000` / error `SPH_RANGE` | boundary |
| `""`, `"abc"`, 500 chars | error `INVALID`, no throw | hostile |
| CYL `-1.00`, AXIS empty | `AXIS_REQUIRED` on that eye | cross-field |
| CYL `0`, AXIS `90` | valid, axis dropped | cross-field |
| PROGRESSIVE, ADD empty | `ADD_REQUIRED` | rx-type rule |
| SINGLE_VISION, ADD `+2.00` | valid, add dropped | ignored field |
| PD `"63.5"` / `"63.3"` | `635` / `PD_STEP` | PD step |

## Steps

1. Implement the parsers; normalise Unicode minus and comma first.
2. Implement `validatePrescription`; return all errors, not the first.
3. Every Examples row as a test, plus a property test: `parse(formatDiopter(x)) == x` for every legal x.

## Self-check

1. `0.1 + 0.2`-style float error: parse via string splitting or `Math.round(n*100)`, and test `-0.75`.
2. `"-0"` and `"-0.00"` parse to `0`, not `-0`.
3. Errors carry the eye, so the UI highlights the right row.
4. Parser checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run packages/rx-core/src/rx/parse.test.ts` passes: every Examples parse row is a case; round-trip property test over all legal SPH values. [unit]
- [x] `pnpm vitest run packages/rx-core/src/rx/validate.test.ts` passes: every cross-field row is a case; a prescription with three errors returns all three. [unit]
- [x] INV-5: parsers return integers only; a test asserts `Number.isInteger` on every parsed output. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/10-rx-parser-validation.md` lists the parsers, validator and error-code enum. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 10 implemented by coder agy-4 (engine agy) in worktree `spec-10` on branch `spec/10-rx-parser-validation`. No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Landed `packages/rx-core/src/rx/{parse.ts,parse.test.ts,validate.ts,validate.test.ts}` and inventory fragment `specs/inventory/10-rx-parser-validation.md`.
- **2026-11-08** — Decisions: (1) `parseDiopterText` supports Unicode minus (U+2212, U+2013, U+2014, U+FE63, U+FF0D), comma decimals, plano strings (`PL`, `plano`, `0`), and leading decimal points (`.75`, `-.75`) via string splitting into integer hundredths without floating-point arithmetic. (2) `parseDiopterText` normalizes `-0` and `"-0.00"` to strictly `+0` (`Object.is(val, 0) === true`, `Object.is(val, -0) === false`, `1 / val === Infinity`). (3) `parseAxis` parses 1–180 integer degrees; `parsePd` parses 0.5 mm steps (5 tenths) for single PD (50.0–80.0 mm / 500–800 tenths) and dual PD (25.0–40.0 mm / 250–400 tenths). `parseDualPd` parses both eyes. (4) `validatePrescription` collects and returns all validation errors (`RxValidationError[]`), with each eye error tagged with `eye: "od" | "os"` and `path` for UI / API mapping. (5) `normalizePrescription` drops `axis` when `cyl` is 0 or absent, drops `add` when `rxType === "SINGLE_VISION"`, and resets fields for `NON_PRESCRIPTION`. `validateAndNormalizePrescription` provides an ergonomic result union. (6) `RX_VALIDATION_CODES` (and alias `RX_ERROR_CODES`) exported from both `validate.ts` and `parse.ts`.
- **2026-11-08** — Self-check 1: Float error avoidance tested with `-0.75` (yielding integer `-75`), leading decimals (`-.75`, `.75`), quarter steps; `Number.isInteger` holds on all parsed values.
- **2026-11-08** — Self-check 2: `"-0"`, `"-0.00"`, `"−0"`, and `"-0,00"` tested; `Object.is(res.value, -0)` is false, `Object.is(res.value, 0)` is true, `1 / res.value === Infinity`.
- **2026-11-08** — Self-check 3: Errors carry `eye: "od"` or `eye: "os"` on all eye-specific fields (SPH, CYL, AXIS, ADD, dual PD), enabling row-level highlighting.
- **2026-11-08** — Self-check 4: Parser checklist (`spec-quality.md` §8) checked and holds: deterministic behavior, no unhandled exceptions on hostile input (empty, "abc", 500 chars), integer units internally (INV-5), step checks (quarter diopter, 0.5 mm PD), boundary checks inclusive.
- **2026-11-08** — Sabotage: (1) In `parse.ts`: sabotage signed calculation to always positive (`let signedHundredths = absHundredths`) → red (12 failed tests, including negative diopter and round-trip); restored. (2) In `validate.ts`: sabotage `AXIS_REQUIRED` check when `cyl !== 0` → red (7 failed tests, including cross-field and multi-error tests); restored.
- **2026-11-08** — Gates after last code change:
  - `pnpm vitest run packages/rx-core/src/rx/parse.test.ts` → `Test Files  1 passed (1)` / `Tests  30 passed (30)`
  - `pnpm vitest run packages/rx-core/src/rx/validate.test.ts` → `Test Files  1 passed (1)` / `Tests  18 passed (18)`
  - `pnpm test` → `Test Files  14 passed (14)` / `Tests  223 passed (223)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
- **2026-11-07** — Evidence (orchestro spec verify, tree 1bd64329): install pass · typecheck pass · lint pass · build pass · test pass 223/0/0
