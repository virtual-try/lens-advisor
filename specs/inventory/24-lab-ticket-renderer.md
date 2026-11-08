# Inventory fragment — Spec 24 (Lab job ticket renderer (PDF and CSV))

### `ticket-data-type`
`app/features/lab-orders/ticket/types.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `TicketData` interface representing the complete lab ticket payload filled by spec 30: order name/number, frame title and SKU, lens name, lab-code template and chosen options/overrides, option labels, add-on names, prescription (from spec 03), source (`MANUAL` or `UPLOAD`), upload file names, out-of-limits flag (`rxOutOfLimits`), notes, and creation date.
**Use instead of:** ad-hoc or local job ticket types.
**Added by:** spec 24.

### `render-pdf`
`app/features/lab-orders/ticket/pdf-renderer.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `renderPdf(TicketData): Promise<Buffer>` produces a one-page A4 PDF lab job ticket in memory via pdfkit. Renders order information, frame title/SKU, lens name, compiled lab code (spec 12), compiler warnings (such as `UNKNOWN_TOKEN`) under the code, selected option labels and add-on names, prescription details formatted via rx-core formatters (OD, OS, PD, notes), an out-of-limits warning band when `rxOutOfLimits=true`, and "Prescription file attached" with attached file names when source is `UPLOAD`.
**Use instead of:** manual PDF construction or HTML-to-PDF rendering in workers.
**Added by:** spec 24.

### `render-csv`
`app/features/lab-orders/ticket/csv-renderer.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `renderCsv(TicketData): Buffer` produces an RFC 4180-compliant UTF-8 CSV buffer containing a standard header row and one row per eye (OD and OS). Includes order metadata, compiled lab code (spec 12), options, add-ons, source, `rx_out_of_limits` column, uploaded files, eye designation, and eye prescription columns (sph, cyl, axis, add, pd, notes). Implements formula injection prevention (values starting with `=`, `+`, `-`, `@` are prefixed with `'`, except numeric diopter columns which are safe).
**Use instead of:** ad-hoc CSV string joining or unquoted CSV formatting.
**Added by:** spec 24.
