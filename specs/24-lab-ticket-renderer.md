# Spec 24 — Lab job ticket renderer (PDF and CSV)

**Status:** Not started
**Depends on:** Spec 03, Spec 12
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/features/lab-orders/ticket/`, `specs/inventory/24-lab-ticket-renderer.md`
**Reuses:** `packages/rx-core/src/lab-code/` (spec 12), `packages/rx-core/src/format/` (spec 03), `packages/rx-core/src/index.ts` (spec 03)
**Kind:** logic
**Invariants:** INV-2, INV-5

## Goal

Pure renderers: given a `TicketData` value — order number, frame, lens, lab-code template and chosen
options, add-ons, both eyes' prescription, PD, upload note — produce the PDF and/or CSV a lab can work
from, in memory. Loading and decrypting the data is spec 30's.

## Scope

- `TicketData` type (exported here, filled by spec 30): order name, frame title/SKU, lens name, lab-code
  template + option tokens/overrides, option labels, add-on names, `Prescription` (spec 03), source
  MANUAL/UPLOAD + file names, `rxOutOfLimits`. The renderer compiles the lab code with spec 12.
- `renderPdf(TicketData) → Buffer` (one A4 page; library chosen in spec 00) and `renderCsv(TicketData) →
  Buffer` (UTF-8, header row, one row per eye; fields quoted per RFC 4180).
- If the prescription was uploaded as a file rather than typed, the ticket says "Prescription file
  attached" and lists the file names; the dispatch job (30) attaches the files.
- The out-of-limits flag from spec 23 prints as a warning band on the PDF and a column in the CSV.

## Explicit non-scope

- Storing or emailing the ticket → spec 30.
- Live lab formats (HOYA XML, OMA, VisionWeb) → out of MVP (spec 00, `README.md`).

## Reuse first

- Named in detail: `compileLabCode` (spec 12), `formatDiopter`/`formatPd`, `Prescription`, `Money` types (spec 03)
- Formatters from spec 03 — no local diopter formatting. Lab code from spec 12.

## Wiring

Real, used now: compiler (12), formatters (03). Stubbed: none. Consumer: 30.

## Examples

| Input | Expected | Why this row |
| --- | --- | --- |
| typed Rx OD −2.25/−0.50×180, OS −2.00, PD 63.5 | CSV row OD `-2.25,-0.50,180`; OS `-2.00,,`; PD `63.5` | normal |
| frame title `Ava, "Tortoise"` | CSV field `"Ava, ""Tortoise"""` | CSV quoting |
| uploaded-file Rx | PDF text "Prescription file attached" | upload path |
| `rxOutOfLimits=true` | PDF warning band text; CSV column `rx_out_of_limits=true` | flag |
| lab-code warning `UNKNOWN_TOKEN` | printed under the code on the PDF | compiler warning |
| minimal ticket (no options, no add-ons, no notes) | CSV emits empty cells for options, add-ons, files, notes; PDF renders "Options: None", "Add-ons: None", no Rx table | minimal / empty data |
| single-item lists (`optionLabels=["Anti-Reflective Coating"]`, `addOnNames=["Edge Polish"]`, `uploadFileNames=["single_scan.pdf"]`) | CSV emits single values without delimiter; PDF renders exact single item without trailing comma or "+N more" | single-item list boundary |

Ties and rounding do not apply in spec 24: all prescription values come pre-formatted from rx-core formatters (INV-5), so the renderers perform zero numeric rounding or tie-breaking.

## Steps

1. `TicketData` type; 2. CSV renderer; 3. PDF renderer (pdfkit); 4. tests extract PDF text to assert content.

## Self-check

1. CSV injection: a value starting with `=`, `+`, `-`, `@` is prefixed with `'` — except numeric diopter
   columns, which are emitted by the formatter and are safe. Test both.
2. No Rx value is logged on error (INV-2).
3. Logic checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/features/lab-orders/ticket` passes: every Examples row is a case; PDF text extraction asserts both eyes and the lab code. [unit]
- [x] INV-2: a test forces a render error and asserts the thrown message and captured logs contain no Rx value. [unit]
- [x] INV-5: the ticket's numbers come from spec 03 formatters (`rg 'toFixed' app/features/lab-orders/ticket` finds nothing). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/24-lab-ticket-renderer.md` lists `TicketData`, `renderPdf`, `renderCsv`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 24 implemented by agy-1 in worktree `spec-24` (branch `spec/24-lab-ticket-renderer`). No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Installed `pdfkit` 0.20.2 (root dependency) and `@types/pdfkit` 0.17.7, `pdf-parse` 2.4.5, `@types/pdf-parse` 1.1.5 (root devDependencies) for in-memory PDF generation and test text extraction.
- **2026-11-08** — Built `app/features/lab-orders/ticket/{types.ts,csv-renderer.ts,pdf-renderer.ts,index.ts,ticket.test.ts}` and created inventory fragment `specs/inventory/24-lab-ticket-renderer.md`.
- **2026-11-08** — Decisions: (1) `TicketData` models order name/number, frame title/SKU, lens name, lab-code template and chosen options/overrides, option labels, add-on names, prescription, source `MANUAL` / `UPLOAD`, file names, `rxOutOfLimits`, and notes. (2) `renderCsv` produces RFC 4180 CRLF output with header row and two rows (OD and OS); CSV injection protection prefixes values starting with `=`, `+`, `-`, or `@` with `'` on all non-diopter text columns, while safely omitting the prefix on numeric diopter columns (`sph`, `cyl`, `add`). (3) `renderPdf` streams a one-page A4 PDF containing order details, frame title/SKU, lens name, compiled lab code (spec 12), compiler warnings (`UNKNOWN_TOKEN`) under the code, selected options/add-ons, and prescription table for both eyes (or "Prescription file attached" and attached file list when source is `UPLOAD`); when `rxOutOfLimits=true`, renders a warning band across the page. (4) Both renderers format diopters via `formatDiopter`, axes via `formatAxis`, and PD via `formatPd` (spec 03 reuse, no local diopter math, no `toFixed`).
- **2026-11-08** — Self-check 1: CSV injection tested and verified. Cells starting with `=`, `+`, `-`, `@` are prefixed with `'` on non-diopter fields (`frameTitle`, `notes`, `options`, etc.); numeric diopter columns (`sph`, `cyl`, `add`) are emitted without `'` prefix. Tested both negative (`-2.25`, `-0.50`) and positive (`+0.25`, `+2.00`) diopter values, plano (`PL`), and hostile formulas (`=CMD(...)`, `-50mm`, `@admin`).
- **2026-11-08** — Self-check 2: INV-2 verified. Forced render errors in both `renderCsv` and `renderPdf` with distinctive test Rx values (SPH −7.75, CYL −1.25 × 137, ADD +2.50, PD 64.5, sensitive patient notes); verified that thrown error messages and captured console logs contain zero Rx values or notes.
- **2026-11-08** — Self-check 3: Logic checklist (`spec-quality.md` §8) holds: all Examples table rows covered with unit test cases; PDF text extraction asserts both eyes and the compiled lab code; dual PD formatted per eye; plano SPH formatted as `PL`; special characters (quotes, commas, newlines) escaped per RFC 4180; long strings and unicode characters handled safely.
- **2026-11-08** — Sabotage: (1) disable diopter exemption from CSV injection prefixing (`isNumericDiopter` check removed) → 4 tests red (`expected '\'-2.25' to be '-2.25'`), restored; (2) disable out-of-limits warning band check in `pdf-renderer.ts` (`if (false && data.rxOutOfLimits)`) → 1 test red (`expected PDF text to contain 'WARNING'`), restored.
- **2026-11-08** — Gates after last code change:
  - `pnpm vitest run app/features/lab-orders/ticket` → `Test Files  1 passed (1)` / `Tests  14 passed (14)`
  - `rg 'toFixed' app/features/lab-orders/ticket` → 0 matches
  - `pnpm test` → `Test Files  31 passed (31)` / `Tests  441 passed (441)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
- **2026-11-08** — Evidence (orchestro spec verify, tree 9666306e): install pass · typecheck pass · lint pass · build pass · test pass 629/0/0
- **2026-11-08** — Review R1 fixes applied by agy-1 (accepted findings R1-F1..R1-F6):
  - R1-F1: Fixed INV-2 error privacy so all renderer failures (including PDFKit-layer and stream errors) surface as a fixed, data-free error (`TICKET_RENDER_FAILED`) with no original message or cause. Added test forcing a PDFKit text-layer failure with sensitive Rx notes and asserted none reaches error or logs.
  - R1-F2: Formatted CSV axes via rx-core `formatAxis` for both eyes (INV-5); added unit test verifying boundary axes 1 -> `001` and 180 -> `180`.
  - R1-F3: Embedded Unicode TrueType font `DejaVuSans` and `DejaVuSans-Bold` from npm package `dejavu-fonts-ttf` (covering Latin, Latin-extended, Greek, Cyrillic) and asserted extracted Unicode text for 'Lunettes élégance Łódź'. Noted that CJK glyphs are out of scope for MVP; tested that CJK input renders 1 page without throwing.
  - R1-F4: Enforced one-page A4 contract by truncating long lists with explicit '+N more' marker and constraining long text/notes. Added test for 200 options, 100 add-ons, and long notes, asserting parsed page count is exactly 1.
  - R1-F5: Made PDF output deterministic by fixing PDF metadata timestamps `CreationDate` and `ModDate` to a fixed constant (no random IDs). Added test verifying byte equality across advanced fake clocks.
  - R1-F6: Updated Examples table and test suite with minimal data (no options, no add-ons, no notes) and single-item list cases. Noted that ties and rounding do not apply (values come pre-formatted from rx-core, INV-5).
- **2026-11-08** — Review R2 fix applied by agy-1 (accepted finding R2-F1):
  - R2-F1: Bound every free-text field (`labCode`, `orderName`, `frameTitle`, `lensName`, `notes`) to a fixed box with explicit truncation and visible marker (`…`), laid out so the Rx block (`OD`, `OS`, `PD`) always has reserved space. Added stress tests asserting 10,000-character lab code and order name result in exactly one page with extractable OD, OS, and PD text and truncation marker present.
