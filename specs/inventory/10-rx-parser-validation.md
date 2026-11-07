# Inventory fragment — Spec 10 (Rx parser and validation)

### `parse-diopter-text`
`packages/rx-core/src/rx/parse.ts` — `parseDiopterText(text, options?)` (alias `parseDiopter`) parses shopper input text into signed integer hundredths of a diopter (`Diopter`). Normalizes Unicode minus (−, U+2212 and variants), comma decimals (,), plano representations (`PL`, `plano`, `0`, `0.00`), and negative zero (`"-0"`, `"-0.00"` → `0`). Quarter-step validation (0.25 D = 25 hundredths) and field range checks are performed via string splitting and integer arithmetic without float drift. Returns `ParseResult<Diopter>` (`{ ok: true, value } | { ok: false, error }`). Also exports convenience helpers `parseSphText`, `parseCylText`, and `parseAddText`.
**Use instead of:** `parseFloat`, `Number(...)`, or ad-hoc diopter regex parsing.
**Added by:** spec 10.

### `parse-axis`
`packages/rx-core/src/rx/parse.ts` — `parseAxis(text)` parses user input into integer degrees 1–180 (`Axis`). Rejects non-integers, out-of-range values, and hostile text with `AXIS_RANGE` or `INVALID`. Returns `ParseResult<Axis>`.
**Use instead of:** unvalidated `parseInt` or manual axis range checks.
**Added by:** spec 10.

### `parse-pd`
`packages/rx-core/src/rx/parse.ts` — `parsePd(text, options?)` and `parseDualPd(odText, osText)` parse single or dual pupillary distance text into integer tenths of a millimetre (`PdTenthsMm`). Enforces 0.5 mm steps (5 tenths) and inclusive ranges (single: 50.0–80.0 mm / 500–800 tenths; dual: 25.0–40.0 mm / 250–400 tenths). Returns `ParseResult<PdTenthsMm>` or `ParseResult<{ od, os }>`.
**Use instead of:** float-based PD parsing or manual step/range calculations.
**Added by:** spec 10.

### `validate-prescription`
`packages/rx-core/src/rx/validate.ts` — `validatePrescription(rx, rxType)` checks a prescription against clinical rules and RxType constraints, returning an array of all `RxValidationError` items (`{ field, eye?, path?, code }`). Also exports `isValidPrescription(rx, rxType)`, `normalizePrescription(rx, rxType)` (which drops AXIS when CYL is 0 or absent and drops ADD for `SINGLE_VISION`), and `validateAndNormalizePrescription(rx, rxType)`.
**Use instead of:** custom prescription checks in routes or step components.
**Added by:** spec 10.

### `rx-validation-codes`
`packages/rx-core/src/rx/validate.ts` (also re-exported from `packages/rx-core/src/rx/parse.ts`) — `RX_VALIDATION_CODES` (alias `RX_ERROR_CODES`) closed enum of error codes: `SPH_RANGE`, `SPH_STEP`, `SPH_REQUIRED`, `CYL_RANGE`, `CYL_STEP`, `AXIS_REQUIRED`, `AXIS_RANGE`, `ADD_REQUIRED`, `ADD_RANGE`, `ADD_STEP`, `PD_REQUIRED`, `PD_RANGE`, `PD_STEP`, `NON_PRESCRIPTION_NOT_EMPTY`, `INVALID`. Types `RxValidationCode` and `RxErrorCode`.
**Use instead of:** raw string literals for prescription validation errors.
**Added by:** spec 10.
