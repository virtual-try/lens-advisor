# Spec 35 — Configurator design token fix

**Status:** Not started
**Depends on:** Spec 34
**Model:** Light — `claude-haiku-5-5` · `gpt-6-luna` · `gemini-3.5-flash-lite`
**Issue:** —
**Owns:** `packages/configurator/src/steps/02-prescription/prescription.css`
**Reuses:** `DESIGN-SYSTEM.md`, `INVARIANTS.md`, `ARCHITECTURE.md`
**Kind:** bugfix
**Invariants:** INV-7

## Goal

Resolve the design system token defect found during the Spec 34 verification pass by replacing the non-existent token `--la-radius-full` in `prescription.css` with the canonical design system token `--la-radius-pill`.

## Scope

- In `packages/configurator/src/steps/02-prescription/prescription.css:408`, update `border-radius: var(--la-radius-full);` on `.la-progress` to `border-radius: var(--la-radius-pill);`.
- Rebuild the configurator bundle and verify all checks pass.

## Explicit non-scope

- Introducing new tokens into `DESIGN-SYSTEM.md`.
- Modifying token values in `packages/configurator/src/styles/tokens.css`.
- Changes to production application code outside the scoped CSS token fix in `packages/configurator/src/steps/02-prescription/prescription.css`.
- New features or unrelated refactoring.

## Reuse first

- `DESIGN-SYSTEM.md` token list and definitions.
- `packages/configurator/src/styles/tokens.css` `--la-radius-pill`.

## Wiring

Real, used now: configurator bundle. In tests: component tests. Stubbed: none. Consumers: storefront theme app block.

## Examples

| Context | Current CSS | Required CSS |
|---|---|---|
| `.la-progress` border radius | `border-radius: var(--la-radius-full);` | `border-radius: var(--la-radius-pill);` |

## Steps

1. In `packages/configurator/src/steps/02-prescription/prescription.css`, replace `--la-radius-full` with `--la-radius-pill`.
2. Run `pnpm --filter @lens-advisor/configurator build` to rebuild the bundle.
3. Run `rg "radius-full" packages/configurator/` to confirm 0 hits.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test`.

## Self-check

1. `rg "radius-full" packages/configurator/` returns 0 hits.
2. `packages/configurator` builds cleanly with no errors.

## Done when

- [x] `packages/configurator/src/steps/02-prescription/prescription.css` uses `--la-radius-pill`; `rg "radius-full" packages/configurator/` returns 0 hits. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]
- [x] `pnpm test` passes with 0 failures. [unit]

## Log

- **2026-11-09** — Spec created to address design token finding R2-F6 / Spec 34 verification pass.
- **2026-11-09** — Replaced `--la-radius-full` with canonical design token `--la-radius-pill` in `packages/configurator/src/steps/02-prescription/prescription.css:408` on `.la-progress`:
  - Verified `rg "radius-full" packages/configurator/` returns 0 hits.
  - Rebuilt configurator bundle via `pnpm --filter configurator build` (`extensions/lens-configurator/assets/configurator.js`).
  - Gates:
    - `pnpm typecheck`: 0 errors.
    - `pnpm lint`: 0 errors, 0 warnings.
    - `pnpm build`: cleanly built (assets: `configurator.js` 202.38 kB / 197.64 KB, `loader.css` 3.32 kB, `loader.js` 1.31 kB).
    - `pnpm test`: 75 test files passed, 1353 tests passed, 0 failures.
    - `pnpm test:e2e --project=server`: 30 passed, 0 failures.
- **2026-11-09** — Evidence (orchestro spec verify, tree 64ce2a90): install pass · typecheck pass · lint pass · build pass · test pass 1354/0/0
- **2026-11-09** — Review fix round R1:
  - R1-F1: Added CSS regression test in `packages/configurator/src/steps/02-prescription/prescription.test.tsx` asserting `.la-progress` rule uses `--la-radius-pill` and excludes `radius-full` (reverting to `--la-radius-full` fails the test).
