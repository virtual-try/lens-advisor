# Spec 26 — Configurator steps 1–2: Rx type and prescription

**Status:** Done
**Depends on:** Spec 10, Spec 16
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `packages/configurator/src/steps/01-rx-type/`, `packages/configurator/src/steps/02-prescription/`, `specs/inventory/26-step-rx-type-and-prescription.md`
**Reuses:** `packages/configurator/src/shell/` (spec 16), `packages/configurator/src/shared/` (spec 16), `packages/rx-core/src/rx/parse.ts` (spec 10), `packages/rx-core/src/rx/validate.ts` (spec 10), `design/v3/product.html`, `design/v3/prescription.html`, `DESIGN-SYSTEM.md#component-conventions`
**Kind:** ui
**Invariants:** INV-2, INV-7, INV-9

## Goal

The shopper picks what kind of lenses they need, then either types their prescription in a mobile-friendly
OD/OS grid with inline help, or uploads a photo/PDF — and leaves step 2 holding an `rxRef`.

## Scope

- Step 1: four choices (single vision, progressive, reading, non-prescription) as large radio cards with a
  one-line explanation and "from <lowest lens price>" computed from the catalog for that Rx type; types
  with no lens are hidden.
- Step 2 (not applicable for non-prescription): tabs "Enter manually" / "Upload", each shown only if the
  shop enables it (`settings` from the catalog). Manual: OD/OS rows SPH, CYL, AXIS, ADD (ADD only for
  progressive/reading), PD single with "I have two PD numbers" toggle; values parsed on blur with spec 10,
  errors inline under the field from `strings.ts` keyed by error code; "What do these mean?" disclosure.
  Upload: pick/drag file or camera (`accept`, `capture`), progress, file chip with remove, max 10 MB, types
  per spec 06; privacy note "Stored encrypted".
- Continue: submits via the API client; server 400 field errors map back onto the fields; success stores
  `rxRef` in state. `isComplete` = `rxRef` present (or non-prescription).

## Explicit non-scope

- Lens choice → spec 27. Add to cart → spec 29.

## Reuse first

- Named in detail: step module contract, API client, reducer actions (16), `parseDiopterText`/`validatePrescription` + error codes (10), `design/v3/product.html`, `design/v3/prescription.html`, `DESIGN-SYSTEM.md#component-conventions`
- spec 10 — the browser runs the same validation the server re-runs; no local regex validation.
- Shell's API client — no direct `fetch` in steps.

## Wiring

Real, used now: shell (16), rx-core (10). Tests: fake API client in context. Stubbed: none.

## Examples

| Interaction | Expected | Why this row |
| --- | --- | --- |
| choose Progressive, type OD −2.25/−0.50×180 ADD +2.00, OS −2.00 ADD +2.00, PD 63 | Continue enabled; submit; rxRef stored | normal |
| CYL −0.50, AXIS empty, blur | inline "Axis is required when you enter a cylinder" | cross-field |
| type "2.3" in SPH | inline step error | invalid |
| server returns 400 with `od.axis` | error shown under OD AXIS | server mapping |
| upload 11 MB file | inline size error, no request | size |
| shop disables manual entry | only Upload shown, no tabs | settings |
| Non-prescription chosen | step 2 skipped | applicability |

## Steps

1. Step 1 module; 2. manual grid; 3. upload tab; 4. Examples tests by role and text.

## Self-check

1. At 375 px the OD/OS grid fits without horizontal scroll (layout from `design/v3/prescription.html`).
2. Every field has a visible label and an `aria-describedby` to its error.
3. INV-2: Rx values never go to `console`, analytics or the URL.
4. UI checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/configurator/src/steps/01-rx-type packages/configurator/src/steps/02-prescription` passes: every Examples row is a case, asserted by role and text. [unit]
- [ ] INV-2: a test spies on `console.*` across a full manual submit and asserts no Rx value is passed. [unit]
- [ ] INV-7: the raw-value `rg` from INVARIANTS.md finds nothing in these folders. [static]
- [ ] INV-9: every message comes from the steps' `strings.ts` (`rg` for JSX text literals finds none). [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/26-step-rx-type-and-prescription.md` lists the step modules and any shared field component. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
