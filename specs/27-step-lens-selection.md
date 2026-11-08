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
  - `store.ts`: In-memory chosen lens group ID accessor (`getSelectedLensGroupId`, `setSelectedLensGroupId`, `clearSelectedLensGroupId`), deriving from `state.selection.lensId` when set.
  - `strings.ts`: User-visible strings for Step 3 (INV-9).
  - `OptionCard.css`: Accessible choice card styling adhering strictly to `tokens.css` with zero raw values (INV-7).
  - `OptionCard.tsx`: Accessible choice card component with radio input, touch target (min 44 px), badge, description, price label, and screen reader announcements (`aria-describedby` linked to `.la-choice__reason`).
  - `LensGroupStep.tsx`: Step 3 Preact view rendering lens groups as cards with "from" prices, filtering out groups with zero lenses for active `rxType`, handling radio selection and resetting lens when group changes, and supporting arrow-key keyboard navigation.
  - `index.tsx`: StepModule contract implementation (`id: "lens-group"`, `titleKey: "lens_group"`, `isComplete`, `isApplicable`, `Component`).
  - `lens-group.test.tsx`: Comprehensive unit tests covering rendering, lowest-price calculation, prescription type filtering (Row 4: READING hides group with 0 matching lenses), selection gating, keyboard navigation, and static invariants (INV-7, INV-9).
- **2026-11-08** — Landed `packages/configurator/src/steps/04-lens/`:
  - `strings.ts`: User-visible strings and reason text templates for Step 4 (INV-9).
  - `format-reason.ts`: Diopter reason formatter mapping `LimitExceededReason` codes to human text via `formatDiopter` and typographic minus (`\u2212`, INV-5).
  - `lens.css`: Banner and notice styles adhering strictly to `tokens.css` (INV-7).
  - `LensStep.tsx`: Step 4 Preact view rendering lenses of the chosen group. Integrates `filterLenses` (spec 11) using the in-memory prescription and `rxType`. Lists available lenses first (catalog order) followed by unavailable lenses (catalog order). Renders disabled lenses with `aria-disabled="true"`, `disabled`, and `aria-describedby` linked to reason text. When all lenses are unavailable, renders notice banner with "Change prescription" button dispatching `{ type: "GO_TO_STEP", stepIndex: 1 }`. Handles ArrowDown/ArrowRight and ArrowUp/ArrowLeft skipping disabled lenses.
  - `index.tsx`: StepModule contract implementation (`id: "lens"`, `titleKey: "lens"`, `isComplete`, `isApplicable`, `Component`).
  - `lens.test.tsx`: Comprehensive unit tests covering all Examples rows: Row 1 (SV, OD −2.25 enabled and selectable), Row 2 (SV, OD −8.25 disabled with reason mentioning "−8.25" and "−8.00"), Row 3 (SV, OD +5.00/+1.50x90 disabled after transposition to +6.50), Row 5 (all lenses unavailable renders explanation and "Change prescription" returning to Step 2), Row 6 (arrow keys skip disabled lenses), and static invariants (INV-5, INV-7, INV-9).
- **2026-11-08** — Created inventory fragment `specs/inventory/27-step-lens-selection.md` documenting step modules, shared store, `OptionCard`, and reason formatter.
- **2026-11-08** — Self-checks verified:
  1. Disabled lenses are announced with their reason to screen readers via `aria-disabled="true"`, `disabled`, and `aria-describedby` linked to `la-reason-<lensId>` element.
  2. Reason text uses the formatter (`formatReasonDiopter` calling `formatDiopter`, producing "−8.25" and "−8.00", not raw integers or extra decimals).
  3. UI checklist (`spec-quality.md` §8) holds: touch targets ≥ 44 px, focus outlines with token offsets, accessible color contrasts, empty/dead-end states handled.
- **2026-11-08** — Gates verified:
  - `pnpm vitest run packages/configurator/src/steps/03-lens-group packages/configurator/src/steps/04-lens`: 2 test files passed, 23 tests passed, 0 failures.
  - `pnpm test`: 60 test files passed, 1010 tests passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint` (`eslint . --max-warnings 0`): exit 0.
  - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit, `configurator.js` 112393 B, `loader.css` 3319 B).
  - `git diff --check`: clean (exit 0).
- **2026-11-08** — Evidence (orchestro spec verify, tree cfffffc6): install pass · typecheck pass · lint pass · build pass · test pass 1010/0/0
