# Inventory fragment — Spec 26 (Configurator steps 1–2: Rx type and prescription)

### `configurator-step-rx-type`
`packages/configurator/src/steps/01-rx-type/index.tsx` & `RxTypeStep.tsx` — Step 1 of the storefront configurator. Renders four vision need options (`SINGLE_VISION`, `PROGRESSIVE`, `READING`, `NON_PRESCRIPTION`) as large accessible radio cards with pictograms, one-line descriptions, and "from <lowest lens price>" computed dynamically from `catalog.lensGroups`. Types with no lenses in the catalog are automatically hidden. Includes the "Not sure which one you need?" clinical help disclosure. Exports the step module contract `{ id: "rx-type", titleKey: "Vision", isComplete(state), isApplicable(state), Component }`.
**Use instead of:** Hardcoding Rx type cards or computing lens tier prices manually.
**Added by:** spec 26.

### `configurator-step-prescription`
`packages/configurator/src/steps/02-prescription/index.tsx` & `PrescriptionStep.tsx` — Step 2 of the storefront configurator. Skipped when `rxType === "NON_PRESCRIPTION"`. Provides "Type it in" manual diopter entry and "Upload a photo" tabs, each toggled based on the shop's catalog settings (`manualRxEnabled` and `rxUploadEnabled`).
- **Manual grid:** OD/OS table with SPH, CYL, AXIS, ADD (ADD only visible for `PROGRESSIVE` and `READING`), and PD (single or dual OD/OS). Inputs are validated on blur using spec 10 (`parseDiopterText`, `parseAxis`, `parsePd`), displaying inline error messages below each field linked via `aria-describedby`. Supports "Same as right eye? Copy to left" quick-fill and the "What do these numbers mean?" help disclosure. Mobile layout at 375 px stacks row labels above inputs without horizontal scroll.
- **Upload panel:** Pick/drag file or camera capture (`accept`, `capture`) supporting JPEG, PNG, HEIC, and PDF up to 10 MB. Preflight checks reject oversized or invalid files locally with no API call. Performs presigned upload via `api.getUploadUrl` and `api.uploadFile`, displays upload progress, and renders a removable file chip with formatted file size.
- **Continue & submission:** Submits via `api.submitPrescription`. Server 400 validation error paths (e.g. `od.axis`) map back to the respective field errors. Upon successful submission, stores `rxRef` in configurator state and advances.
Exports the step module contract `{ id: "prescription", titleKey: "Prescription", isComplete(state), isApplicable(state), Component }`.
**Use instead of:** Custom prescription input forms or direct unvalidated file uploads.
**Added by:** spec 26.
