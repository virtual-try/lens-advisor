# Inventory fragment — Spec 11 (Rx limits engine)

### `check-lens`
`packages/rx-core/src/limits/check-lens.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `checkLens(rx, rxType, lens)` evaluates whether a lens can accommodate a given prescription and RxType. Transposes plus-cylinder eyes into minus-cylinder form before limits checks. Checks in fixed order: `rxType`, `OD SPH`, `OD CYL`, `OD ADD`, `OS SPH`, `OS CYL`, `OS ADD`. Returns `{ available: true }` or `{ available: false, reason }` where `reason` is `{ code, field, eye, value, limit }` with codes `RX_TYPE_NOT_SUPPORTED`, `SPH_BELOW_MIN`, `SPH_ABOVE_MAX`, `CYL_OUT_OF_RANGE`, `ADD_OUT_OF_RANGE`. Missing ADD limits mean no ADD restriction; non-prescription bypasses prescription checks.
**Use instead of:** ad-hoc SPH/CYL/ADD range comparisons in storefront or server code.
**Added by:** spec 11.

### `filter-lenses`
`packages/rx-core/src/limits/filter-lenses.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `filterLenses(rx, rxType, lenses)` maps an array of lenses against a prescription and RxType, preserving input catalog order deterministically. Each returned item provides `{ lens, result, available, reason? }`.
**Use instead of:** manual looping and filtering of lenses against limits in step 4 or order intake.
**Added by:** spec 11.

### `transpose`
`packages/rx-core/src/limits/transpose.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `transpose(eyeOrRx)` and `transposeEye(eye)` pure functions that perform optical cylinder transposition between plus and minus cylinder forms: `SPH' = SPH + CYL`, `CYL' = -CYL`, `AXIS' = AXIS <= 90 ? AXIS + 90 : AXIS - 90` (wrapping in 1–180, never 0 or 270). Plano CYL (0) or absent CYL is unchanged. Transposing twice returns the original input (involution).
**Use instead of:** ad-hoc manual cylinder transposition or axis conversions.
**Added by:** spec 11.

### `rx-limits-engine-types`
`packages/rx-core/src/limits/types.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — types `CheckLensResult`, `FilteredLens`, `LimitExceededReason`, `LimitExceededCode`, `LimitExceededEye`, `LimitExceededField`, `RxTypeLimitReason`, `DiopterLimitReason`.
**Use instead of:** inline reason objects or untyped availability checks.
**Added by:** spec 11.
