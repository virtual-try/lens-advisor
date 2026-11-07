# Spec 10 — Rx parser and validation

**Status:** Done
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

- [ ] `pnpm vitest run packages/rx-core/src/rx/parse.test.ts` passes: every Examples parse row is a case; round-trip property test over all legal SPH values. [unit]
- [ ] `pnpm vitest run packages/rx-core/src/rx/validate.test.ts` passes: every cross-field row is a case; a prescription with three errors returns all three. [unit]
- [ ] INV-5: parsers return integers only; a test asserts `Number.isInteger` on every parsed output. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/10-rx-parser-validation.md` lists the parsers, validator and error-code enum. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
