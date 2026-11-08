# Spec 27 — Configurator steps 3–4: lens group and lens, with Rx limits

**Status:** Not started
**Depends on:** Spec 11, Spec 13, Spec 16
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/configurator/src/steps/03-lens-group/`, `packages/configurator/src/steps/04-lens/`, `specs/inventory/27-step-lens-selection.md`
**Reuses:** `packages/configurator/src/shell/` (spec 16), `packages/rx-core/src/limits/` (spec 11), `packages/rx-core/src/pricing/` (spec 13), `packages/rx-core/src/format/` (spec 03), `design/v3/lenses.html`, `DESIGN-SYSTEM.md#component-conventions`
**Kind:** ui
**Invariants:** INV-5, INV-7, INV-9

## Goal

The shopper chooses a lens group, then a lens; lenses the lab can't make for their prescription stay
visible but disabled with a plain reason ("Not available for your prescription — SPH −9.00 is beyond −8.00").

## Scope

- Step 3: groups as cards (name, description, "from" price); groups with zero lenses for this Rx type hidden.
- Step 4: lenses of the chosen group, each a radio card with price; `filterLenses` decides availability;
  unavailable ones are `aria-disabled` with the reason built from the structured reason via strings +
  `formatDiopter`; available listed first, then unavailable, each keeping catalog order.
- If every lens is unavailable: an explanation and "Change prescription" (goes back to step 2).
- Needs the decrypted-in-browser prescription: the shell keeps the validated values in memory after step 2
  (never persisted, never sent anywhere but the proxy).

## Explicit non-scope

- Options/add-ons → spec 28. Server-side limits flag → spec 23.

## Reuse first

- Named in detail: shell contract + reducer (16), `filterLenses` (11), `priceSelection` (13), `formatDiopter` (03), `design/v3/lenses.html`, `DESIGN-SYSTEM.md#component-conventions`
- spec 11 — no local limit comparisons. spec 03 formatter for the reason text.

## Wiring

Real, used now: 16, 11, 13. Tests: fixture catalog and state. Stubbed: none.

## Examples

Fixture lens L: SPH −800..+600, CYL −400..0, SV + PROGRESSIVE.

| State | Expected | Why this row |
| --- | --- | --- |
| SV, OD −2.25 | L enabled, selectable | normal |
| SV, OD −8.25 | L disabled, reason mentions "−8.25" and "−8.00" | limit |
| SV, OD +5.00/+1.50×90 | L disabled (after transposition +6.50) | plus-cyl |
| READING | L hidden from step 3 count, group hidden if empty | rx type |
| all lenses unavailable | message + "Change prescription" returns to step 2 | dead end |
| keyboard: arrow keys in the radio group | skip disabled lenses | a11y |

## Steps

1. Step 3; 2. step 4 with availability; 3. Examples tests.

## Self-check

1. Disabled lenses are still announced with their reason to screen readers.
2. Reason text uses the formatter (−8.25, not -825 or -8.250).
3. UI checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run packages/configurator/src/steps/03-lens-group packages/configurator/src/steps/04-lens` passes: every Examples row is a case. [unit]
- [x] INV-5: reason values come from integers through `formatDiopter` (test asserts exact text). [unit]
- [x] INV-7: the raw-value `rg` finds nothing in these folders. [static]
- [x] INV-9: strings only from `strings.ts`. [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/27-step-lens-selection.md` lists the step modules and any shared option-card component. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 27 implemented by coder agy-5 (engine agy) in worktree `spec-27` (branch `spec/27-step-lens-selection`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/configurator/src/steps/03-lens-group/`:
  - ~~`store.ts`: In-memory chosen lens group ID accessor (`getSelectedLensGroupId`, `setSelectedLensGroupId`, `clearSelectedLensGroupId`), deriving from `state.selection.lensId` when set.~~ (Deleted in review R1 in favor of shell reducer `state.lensGroupId`).
  - `strings.ts`: User-visible strings for Step 3 (INV-9).
  - `ChoiceCard.css`: Accessible choice card styling adhering strictly to `tokens.css` with zero raw values (INV-7).
  - `OptionCard.tsx`: Accessible choice card component with radio input, touch target (min 44 px), badge, description, price label, and screen reader announcements (`aria-describedby` linked to `.la-choice__reason`).
  - `LensGroupStep.tsx`: Step 3 Preact view rendering lens groups as cards with "from" prices, filtering out groups with zero lenses for active `rxType`, handling radio selection and resetting lens when group changes, and supporting arrow-key keyboard navigation.
  - `index.tsx`: StepModule contract implementation (`id: "lens-group"`, `titleKey: "lens_group"`, `isComplete`, `isApplicable`, `Component`).
  - `lens-group.test.tsx`: Comprehensive unit tests covering rendering, lowest-price calculation, prescription type filtering (Row 4: READING hides group with 0 matching lenses), selection gating, keyboard navigation, and static invariants (INV-7, INV-9).
- **2026-11-08** — Landed `packages/configurator/src/steps/04-lens/`:
  - `strings.ts`: User-visible strings and reason text templates for Step 4 (INV-9).
  - `format-reason.ts`: Diopter reason formatter mapping `LimitExceededReason` codes to human text via `formatDiopter` and typographic minus (`\u2212`, INV-5).
  - `lens.css`: Banner and notice styles adhering strictly to `tokens.css` (INV-7).
  - `LensStep.tsx`: Step 4 Preact view rendering lenses of the chosen group. Integrates `filterLenses` (spec 11) using the in-memory prescription and `rxType`. Lists available lenses first (catalog order) followed by unavailable lenses (catalog order). Renders unavailable lenses with `aria-disabled="true"` (no native `disabled` attribute) and `aria-describedby` linked to reason text. When all lenses are unavailable, renders notice banner with "Change prescription" button dispatching `{ type: "GO_TO_STEP", stepId: "prescription" }`. Handles ArrowDown/ArrowRight and ArrowUp/ArrowLeft skipping disabled lenses.
  - `index.tsx`: StepModule contract implementation (`id: "lens"`, `titleKey: "lens"`, `isComplete`, `isApplicable`, `Component`).
  - `lens.test.tsx`: Comprehensive unit tests covering all Examples rows: Row 1 (SV, OD −2.25 enabled and selectable), Row 2 (SV, OD −8.25 disabled with reason mentioning "−8.25" and "−8.00"), Row 3 (SV, OD +5.00/+1.50x90 disabled after transposition to +6.50), Row 5 (all lenses unavailable renders explanation and "Change prescription" returning to Step 2), Row 6 (arrow keys skip disabled lenses), and static invariants (INV-5, INV-7, INV-9).
- **2026-11-08** — Created inventory fragment `specs/inventory/27-step-lens-selection.md` documenting step modules, shared store, `OptionCard`, and reason formatter.
- **2026-11-08** — Self-checks verified:
  1. Unavailable lenses are announced with their reason to screen readers via `aria-disabled="true"` and `aria-describedby` (no native `disabled` attribute, reason omitted from label via `aria-hidden="true"`).
  2. Reason text uses the formatter (`formatReasonDiopter` calling `formatDiopter`, producing "−8.25" and "−8.00", not raw integers or extra decimals).
  3. UI checklist (`spec-quality.md` §8) holds: touch targets ≥ 44 px, focus outlines with token offsets, reduced-motion overrides, empty/dead-end states handled.
- **2026-11-08** — Review 1 fixes landed by coder agy-5:
  - **R1-F1** [BLOCKER] & **R1-F2** [MAJOR]: Intentional cross-owner edit to spec 16's shell reducer (`packages/configurator/src/shell/`):
    - Added `lensGroupId: string | null` to `ConfiguratorState` (`createInitialState` defaults to `null`).
    - Added `SET_LENS_GROUP` action: `{ type: "SET_LENS_GROUP", lensGroupId: string }`.
    - Reducer table row: `SET_LENS_GROUP` across all statuses sets `state.lensGroupId` and clears `selection.lensId` when changing group.
    - Reducer table row: `CLOSE` and `RESET` clear `lensGroupId` back to `null`.
    - Reducer matrix in `reducer.test.ts` expanded with `SET_LENS_GROUP` on all 5 statuses (`idle`, `loading`, `ready`, `error`, `empty`).
    - Derived `isComplete` in `packages/configurator/src/steps/03-lens-group/index.tsx` directly from `state.lensGroupId`.
    - Added shell-level tests in `shell.test.tsx` verifying picking a group enables Continue (`Footer.tsx`), and reopening for a second frame resets group selection.
    - Deleted module-global `store.ts` (`getSelectedLensGroupId`, `setSelectedLensGroupId`, `clearSelectedLensGroupId`).
  - **R1-F3** [MAJOR]: Removed native `disabled` attribute from `OptionCard.tsx`, keeping `aria-disabled="true"` and `aria-describedby`. Marked `.la-choice__reason` with `aria-hidden="true"` so the reason is omitted from browse mode label calculation and read only via `aria-describedby` in focus mode. Clicks and `onChange` on unavailable lenses are ignored. Updated `ChoiceCard.css` with `[aria-disabled="true"]` rules.
  - **R1-F4** [MAJOR]: Added focus management to arrow-key navigation in `LensGroupStep.tsx` and `LensStep.tsx` using `inputRefs`. Selection and keyboard focus ring (`document.activeElement`) now move together.
  - **R1-F5** [MAJOR]: Added `@media (prefers-reduced-motion: reduce) { transition: none; }` in `ChoiceCard.css` (for `.la-choice`) and `lens.css` (for `.la-notice__btn`).
  - **R1-F6** [MAJOR]: Rewrote INV-7 and INV-9 static checks in `lens-group.test.tsx` and `lens.test.tsx` to read files via `node:fs` and inspect TypeScript AST via `ts.createSourceFile` + `ts.isJsxText`, eliminating fragile shell-outs and catching multi-line JSX text.
  - **R1-F7** [MINOR]: Updated `LensStep.tsx` "Change prescription" handler to dispatch `{ type: "GO_TO_STEP", stepId: "prescription" }`. Supported `stepId` resolution in shell reducer.
  - **R1-F8** [MINOR]: Replaced silent fallback to `lensGroups[0]` with `noGroupSelected` rendering when `lensGroupId` is null.
  - **R1-F10** [MINOR]: Added mixed-group test for Row 4 (matching lenses only), real keyboard event with unavailable lens in the middle, and render tests for no-group and null-catalog states.
  - **R1-F11** [MINOR]: Corrected Log file name (`ChoiceCard.css`), removed unsupported contrast claim, and re-verified Self-check 1 after R1-F3.
  - Gates verified:
    - `pnpm vitest run packages/configurator/src/steps/03-lens-group packages/configurator/src/steps/04-lens`: 2 test files passed, 28 tests passed, 0 failures.
    - `pnpm test`: 60 test files passed, 1026 tests passed, 0 failures.
    - `pnpm typecheck`: exit 0.
    - `pnpm lint` (`eslint . --max-warnings 0`): exit 0.
    - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit, `configurator.js` 113683 B, `loader.css` 3319 B).
    - `git diff --check`: clean (exit 0).
- **2026-11-08** — Review 2 fixes landed by coder agy-5:
  - **R2-F1** [MAJOR]: Formatted zero limits/values as `"0.00"` instead of plano `"PL"` in `packages/configurator/src/steps/04-lens/format-reason.ts` without touching `rx-core`'s `formatDiopter`. Replaced `formatReasonDiopter(0) === 'PL'` assertion in `lens.test.tsx` with zero-limit reason text assertions and added a rendered component test for zero-limit reason text.
  - **R2-F2** [MINOR]: Deleted `TestGroup` test copy in `packages/configurator/src/steps/04-lens/lens.test.tsx` that duplicated arrow-key loops outside production code; the real `LensStep` wrap-around test covers skipping unavailable lenses.
  - **R2-F3** [MINOR]: Corrected/struck stale claims in the initial landed Log lines (`store.ts` struck as deleted in R1, removed native `disabled` reference in `LensStep.tsx`, and updated "Change prescription" action to `stepId: "prescription"`). Status line left untouched (lead-owned).
  - **R2-F4** [MINOR]: The `requestAnimationFrame`/`cancelAnimationFrame` polyfill was not needed (all tests pass without it) and was removed. The real gap: Preact's hooks schedule effects with rAF plus a 100 ms `setTimeout` fallback; when that timer fires after vitest tears down jsdom it calls the removed `cancelAnimationFrame`, giving 3 unhandled ReferenceErrors from `shell.test.tsx` that failed the `test` gate. `src/test/setup.ts` now drains timers in an `afterAll` (150 ms) before teardown; 3 consecutive configurator runs: 228/228, 0 errors (lead, 2026-11-08).
- **2026-11-08** — Evidence (orchestro spec verify, tree 54d1316a): install pass · typecheck pass · lint pass · build pass · test pass 1194/0/0
