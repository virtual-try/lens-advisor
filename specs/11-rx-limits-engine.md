# Spec 11 — Rx limits engine

**Status:** Not started
**Depends on:** Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/rx-core/src/limits/`, `specs/inventory/11-rx-limits-engine.md`
**Reuses:** `packages/rx-core/src/index.ts` (spec 03), `packages/rx-core/src/format/` (spec 03)
**Kind:** logic
**Invariants:** INV-5

## Goal

Given a prescription and a list of lenses, say which lenses the lab can make and, for each one that it
can't, the first reason as a structured value the UI can turn into "SPH −9.00 exceeds −8.00". Runs in the
browser (spec 27) and on the server (spec 23, to flag orders).

## Scope

- `checkLens(rx, rxType, lens) → { available: true } | { available: false, reason }`; `reason` is
  `{ code, field, eye, value, limit }` with codes `RX_TYPE_NOT_SUPPORTED`, `SPH_BELOW_MIN`, `SPH_ABOVE_MAX`,
  `CYL_OUT_OF_RANGE`, `ADD_OUT_OF_RANGE`.
- `filterLenses(rx, rxType, lenses)` → the same list, same order, each with its result.
- **Transposition:** limits are stored in minus-cylinder form. A plus-cyl eye is transposed before the
  check: SPH' = SPH + CYL, CYL' = −CYL, AXIS' = AXIS ± 90 (kept in 1–180).
- Check both eyes; the reason reported is the first failing check in a fixed order: rx type, OD SPH, OD
  CYL, OD ADD, OS SPH, OS CYL, OS ADD.
- Missing ADD limits mean "no ADD restriction".

## Explicit non-scope

- Text parsing and field validity → spec 10 (input here is already valid).
- Rendering the disabled reason → spec 27.
- Flagging an order → spec 23.

## Reuse first

- Named in detail: `Prescription`, `RxLimits`, `Lens` types and `formatDiopter` (spec 03)
- Spec 03 types and formatter. Do not reimplement diopter formatting for the reason string — return data,
  the UI formats.

## Wiring

Real, used now: spec 03 types. Stubbed: none.

## Examples

Hundredths. Limits inclusive. Lens L: SPH −800..+600, CYL −400..0, rx types SV and PROGRESSIVE.

| Rx | Expected for L | Why this row |
| --- | --- | --- |
| OD −225/−225, OS −200/0, SV | available | normal |
| OD −800, SV | available | min boundary inclusive |
| OD −825, SV | `SPH_BELOW_MIN`, OD, value −825, limit −800 | just outside |
| OD +500 / +150 × 90 (plus cyl), SV | transposed to +650 / −150 × 180 → `SPH_ABOVE_MAX` | transposition matters |
| OD +400 / +100 × 180, SV | transposed +500 / −100 × 90 → available | transposition axis wraps |
| any Rx, READING | `RX_TYPE_NOT_SUPPORTED` | rx type first |
| OD fails SPH and OS fails CYL | reason is OD SPH | fixed order |
| NON_PRESCRIPTION, lens allowing it | available | no Rx to check |
| empty lens list | empty result | empty input |

## Steps

1. Implement transposition as its own exported pure function with its own tests.
2. Implement `checkLens` and `filterLenses`.
3. Every Examples row a test case; a property test: transposing twice returns the original.

## Self-check

1. Transposition axis: 90 → 180, 180 → 90, 45 → 135, never 0 or 270.
2. Plano CYL (0) is not "plus cyl" — no transposition.
3. `filterLenses` preserves input order (determinism).
4. Logic checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run packages/rx-core/src/limits` passes: every Examples row is a case; double-transposition property test over generated prescriptions. [unit]
- [x] Sabotage: drop the transposition call → the plus-cyl rows go red; recorded in the Log. [unit]
- [x] INV-5: inputs and reason values are integers; no float comparison in the module (`rg 'parseFloat|toFixed'` finds nothing). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/11-rx-limits-engine.md` lists `checkLens`, `filterLenses`, `transpose`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 11 implemented by coder agy-4 (engine agy) in worktree `spec-11` (branch `spec/11-rx-limits-engine`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/rx-core/src/limits/{types.ts,transpose.ts,check-lens.ts,filter-lenses.ts,index.ts}` and test files `transpose.test.ts`, `limits.test.ts`. Created inventory fragment `specs/inventory/11-rx-limits-engine.md`.
- **2026-11-08** — Decisions:
  1. `transpose` is implemented as an involution overload for both `Eye` and `Prescription`: `transpose(transpose(x)) == x`.
  2. `checkLens` normalizes plus-cylinder eyes (`cyl > 0`) using `transposeEye` prior to limits evaluation against minus-cylinder stored limits. Plano CYL (`cyl === 0`) and absent CYL are untouched.
  3. Fixed check order strictly enforced: (1) rx type, (2) OD SPH, (3) OD CYL, (4) OD ADD, (5) OS SPH, (6) OS CYL, (7) OS ADD.
  4. Missing ADD limits (`addMin` and `addMax` undefined) represent no ADD restriction.
  5. `NON_PRESCRIPTION` bypasses prescription checks if permitted by `lens.limits.rxTypes`.
  6. `filterLenses` preserves input order deterministically, returning `{ lens, result, available, reason? }`.
- **2026-11-08** — Sabotage: dropped transposition call in `check-lens.ts` (`normalizeEyeForLimits`). Running `pnpm vitest run packages/rx-core/src/limits` produced 3 red test failures:
  - Row 4 (+500/+150x90) failed: expected `SPH_ABOVE_MAX`, received `CYL_OUT_OF_RANGE`.
  - Row 5 (+400/+100x180) failed: expected `available: true`, received `available: false` (`CYL_OUT_OF_RANGE`).
  - OS plus-cyl test failed: expected `SPH_ABOVE_MAX`, received `CYL_OUT_OF_RANGE`.
  Restored transposition call; all tests returned to green.
- **2026-11-08** — Self-check:
  1. Transposition axis: 90 → 180, 180 → 90, 45 → 135, never 0 or 270 (tested across all 1..180 angles).
  2. Plano CYL (0) is not "plus cyl" — no transposition (tested in unit and limit tests).
  3. `filterLenses` preserves input order (determinism tested with 3-lens fixture).
  4. Logic checklist: pure functions without side effects; boundary inclusive min/max checks; 300-prescription randomized property test confirms `transpose(transpose(rx)) == rx`; empty lens list returns `[]`.
  5. INV-5: `rg 'parseFloat|toFixed' packages/rx-core/src/limits/` finds nothing; all diopter inputs and reason values are verified integers.
- **2026-11-08** — Final gates run:
  - `pnpm vitest run packages/rx-core/src/limits` → `Test Files 2 passed (2)` / `Tests 38 passed (38)`
  - `pnpm test` → `Test Files 17 passed (17)` / `Tests 273 passed (273)`
  - `pnpm typecheck` → exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) → exit 0
  - `pnpm build` → exit 0
- **2026-11-08** — Review R1 fix (R1-F1): no rounding applies (integer hundredths in and out, INV-5) and limits are inclusive at both ends. Added unit tests for single-lens list (one available, one not), inclusive max boundary (OD +600 available, +625 SPH_ABOVE_MAX), and Rx failing both min and max checks across different eyes.
- **2026-11-07** — Evidence (orchestro spec verify, tree 7d541551): install pass · typecheck pass · lint pass · build pass · test pass 279/0/0
