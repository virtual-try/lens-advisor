# Spec 26 — Configurator steps 1–2: Rx type and prescription

**Status:** Not started
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

- [x] `pnpm vitest run packages/configurator/src/steps/01-rx-type packages/configurator/src/steps/02-prescription` passes: every Examples row is a case, asserted by role and text. [unit]
- [x] INV-2: a test spies on `console.*` across a full manual submit and asserts no Rx value is passed. [unit]
- [x] INV-7: the raw-value `rg` from INVARIANTS.md finds nothing in these folders. [static]
- [x] INV-9: every message comes from the steps' `strings.ts` (`rg` for JSX text literals finds none). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/26-step-rx-type-and-prescription.md` lists the step modules and any shared field component. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 26 implemented by agy-2 in worktree `spec-26` (branch `spec/26-step-rx-type-and-prescription`). No git writes (lead commits).
- **2026-11-08** — Created `packages/configurator/src/steps/01-rx-type/`:
  - `strings.ts`: Centralized user-visible strings for Step 1 radio cards, prices, and guidance disclosure (INV-9).
  - `rx-type.css`: Fully tokenized CSS using variables from `tokens.css` with responsive mobile layout at `<= 40rem` (INV-7).
  - `RxTypeStep.tsx`: Radio cards for `SINGLE_VISION`, `PROGRESSIVE`, `READING`, `NON_PRESCRIPTION`. Computes "from <lowest lens price>" dynamically from `catalog.lensGroups`. Types without available lenses in the catalog are hidden.
  - `index.tsx`: StepModule contract export (`id: "rx-type"`, `titleKey: "Vision"`, `isComplete: (state) => state.rxType !== null`, `isApplicable: () => true`).
  - `rx-type.test.tsx`: 8 unit tests verifying card selection, dynamic pricing, absence of options without lenses, clinical guidance disclosure, and StepModule contract.
- **2026-11-08** — Created `packages/configurator/src/steps/02-prescription/`:
  - `strings.ts`: Centralized user-visible strings for tabs, table headers, OD/OS inputs, dual PD toggle, validation error codes, api errors, disclosures, upload prompt, progress, file chip, and privacy note (INV-9).
  - `prescription.css`: Fully tokenized CSS using variables from `tokens.css`. At mobile (`<= 40rem`), row labels stack above 2-column input grid (`minmax(0, 1fr) minmax(0, 1fr)`) ensuring zero horizontal overflow at 375 px (INV-7).
  - `PrescriptionStep.tsx`:
    - Tab switching between manual entry and file upload based on `settings.manualRxEnabled` and `settings.rxUploadEnabled`.
    - Manual entry: OD/OS inputs for SPH, CYL, AXIS, ADD (ADD rendered only for Progressive and Reading), single/dual PD toggle.
    - Blur validation uses spec 10 parsers (`parseSphText`, `parseCylText`, `parseAxis`, `parseAddText`, `parsePd`) and cross-field checks. All inputs have visible labels and `aria-describedby` linking to error spans.
    - Quick-fill: "Same as right eye? Copy to left" duplicates OD SPH, CYL, AXIS, and ADD into OS.
    - Upload panel: File picker and drag-and-drop supporting JPEG, PNG, HEIC, and PDF up to 10 MB (`accept`, `capture`). Preflight rejects files exceeding 10 MB without making network calls. Presigned upload via `api.getUploadUrl` and `api.uploadFile`, progress indicator, and file chip with remove action.
    - Submission handling: Intercepts Continue click on the shell footer during step 2. Calls `api.submitPrescription(...)`. Maps server 400 validation error paths (e.g. `od.axis`) back to individual field errors. On success, dispatches `SET_PRESCRIPTION_REF` and `CONTINUE`.
  - `index.tsx`: StepModule contract export (`id: "prescription"`, `titleKey: "Prescription"`, `isComplete`, `isApplicable: (state) => state.rxType !== "NON_PRESCRIPTION"`).
  - `prescription.test.tsx`: 14 unit tests covering all 7 Examples table rows, copy-to-left, dual PD mode, upload progress/remove flow, 375 px mobile layout verification, and accessible label/error relationships.
- **2026-11-08** — Self-checks:
  - 1. At 375 px, the OD/OS grid fits without horizontal scroll: verified responsive styles in `prescription.css` and unit test asserting mobile container layout rules; actual 375 px visual overflow is verified in the e2e suite (spec 33) rather than claimed by this unit test.
  - 2. Every field has a visible label and an `aria-describedby` pointing to its error container: verified in unit test across all manual input fields.
  - 3. INV-2: Verified by unit test spying on `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` across full manual submission, asserting no Rx diopter or parameter value is passed to console.
  - 4. UI checklist (`spec-quality.md` §8) satisfied.
- **2026-11-08** — Fix round R1 (accepted findings R1-F1 through R1-F13):
  - R1-F1: Continue interception submits typed manual Rx whenever valid and no prescriptionRef exists, whichever tab is active. Added test for typing, switching tab, and clicking Continue.
  - R1-F2: Clears prescriptionRef on manual value edits, file replacement/removal, and Rx type change in step 1. Added test for submit, edit, Continue calling submitPrescription twice, and for type change.
  - R1-F3: On remount, rehydrates inputs from state.prescription (formatted with formatDiopter and formatAxis) and file chip from state.prescriptionRef. Added tests verifying rehydration.
  - R1-F4: Added visible focus via label:has(input:focus-visible) for PD segment and upload controls, removed tabIndex from wrapping labels, and added tests.
  - R1-F5: Added @media (prefers-reduced-motion: reduce) { transition: none } for .la-choice, .la-tab, .la-segment label, and .la-drop, plus tests.
  - R1-F6: Mapped ApiError.code to strings.ts messages with generic fallback. Never render err.message or raw codes. Strict MIME checking in isFileTypeAllowed requiring allowed MIME types and falling back to extension only when file.type is empty. Added test.
  - R1-F7: Moved KB/MB unit labels into strings.upload.units.
  - R1-F8: Added <progress class="la-progress"> element with accessible label from strings.upload.progressLabel during upload. Added test.
  - R1-F9: Noted in Log that 375 px layout is verified in the e2e suite (spec 33) while keeping CSS structure unit assertion.
  - R1-F10: Linked visible row labels to inputs via aria-labelledby combining eye and field labels, included dual-PD inputs in the test, and asserted visible label text.
  - R1-F11: Restored console spies in afterEach(vi.restoreAllMocks).
  - R1-F12: Asserted CONTINUE dispatch for Row 1, verified shell skipping step 2 for non-prescription (Row 7), and tested Continue interception using real Footer from spec 16.
  - R1-F13: Corrected Log and inventory fragment to match code (parser names, copied fields including ADD, validation codes).
- **2026-11-08** — Sabotage verifications:
  - Sabotage 1: In `packages/configurator/src/steps/01-rx-type/index.tsx`, temporarily forced `isComplete: () => false`. Test failed: `AssertionError: expected false to be true // Object.is equality`. Restored, verified green.
  - Sabotage 2: In `packages/configurator/src/steps/02-prescription/PrescriptionStep.tsx`, temporarily commented out line setting `newErrors.odAxis = strings.errors.AXIS_REQUIRED` on CYL blur with empty AXIS. Test failed: `TestingLibraryElementError: Unable to find an element with the text: Axis is required when you enter a cylinder`. Restored, verified green.
- **2026-11-08** — Inventory fragment created: `specs/inventory/26-step-rx-type-and-prescription.md` documenting `configurator-step-rx-type` and `configurator-step-prescription`.
- **2026-11-08** — Gate results:
  - `pnpm vitest run packages/configurator/src/steps/01-rx-type packages/configurator/src/steps/02-prescription`: 2 test files, 22 passed (0 failures).
  - INV-7 static check: 0 matches for raw hex, rgb, px, or ms outside `tokens.css`.
  - INV-9 static check: 0 matches for raw JSX text literals in `.tsx` files.
  - `pnpm typecheck`: clean (0 errors).
  - `pnpm lint`: clean (0 errors, 0 warnings).
  - `pnpm build`: passed (`configurator.js` 142948 B, `loader.css` 3319 B, `loader.js` 1314 B <= 10240 B limit).
  - `pnpm test`: 60 test files passed, 1009 tests passed (0 failures).
  - `git diff --check`: clean (no whitespace errors or conflict markers).
- **2026-11-08** — Evidence (orchestro spec verify, tree af19c300): install pass · typecheck pass · lint pass · build pass · test pass 1242/0/0
- **2026-11-08** — Merged origin/main bringing branch up to date with specs 27, 28, and 30. Resolved merge conflicts in 4 files: packages/configurator/src/shell/reducer.ts (merged GO_TO_STEP stepId lookup from main with step completion guard from spec 26; retained CLEAR_PRESCRIPTION and SET_RX_TYPE reset logic alongside lensGroupId and lens actions), packages/configurator/src/shell/reducer.test.ts (retained test suites from both sides), packages/configurator/src/shell/shell.test.tsx (retained all tests from both sides: canContinue/onContinue hook tests and lens-group continue tests), and extensions/lens-configurator/assets/configurator.js (checked out theirs then rebuilt configurator bundle). Gates: pnpm typecheck (pass), pnpm lint (pass), pnpm build (pass), pnpm test with TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54316/lens_test (pass: 69 test files passed, 1242 tests passed, 0 unhandled errors).
