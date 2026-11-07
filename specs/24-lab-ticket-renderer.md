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

## Steps

1. `TicketData` type; 2. CSV renderer; 3. PDF renderer (pdfkit); 4. tests extract PDF text to assert content.

## Self-check

1. CSV injection: a value starting with `=`, `+`, `-`, `@` is prefixed with `'` — except numeric diopter
   columns, which are emitted by the formatter and are safe. Test both.
2. No Rx value is logged on error (INV-2).
3. Logic checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/lab-orders/ticket` passes: every Examples row is a case; PDF text extraction asserts both eyes and the lab code. [unit]
- [ ] INV-2: a test forces a render error and asserts the thrown message and captured logs contain no Rx value. [unit]
- [ ] INV-5: the ticket's numbers come from spec 03 formatters (`rg 'toFixed' app/features/lab-orders/ticket` finds nothing). [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/24-lab-ticket-renderer.md` lists `TicketData`, `renderPdf`, `renderCsv`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
