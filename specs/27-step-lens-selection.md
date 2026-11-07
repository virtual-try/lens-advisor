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

- [ ] `pnpm vitest run packages/configurator/src/steps/03-lens-group packages/configurator/src/steps/04-lens` passes: every Examples row is a case. [unit]
- [ ] INV-5: reason values come from integers through `formatDiopter` (test asserts exact text). [unit]
- [ ] INV-7: the raw-value `rg` finds nothing in these folders. [static]
- [ ] INV-9: strings only from `strings.ts`. [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/27-step-lens-selection.md` lists the step modules and any shared option-card component. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
