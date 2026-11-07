# Spec 16 — Configurator shell, state machine and API client

**Status:** Not started
**Depends on:** Spec 03, Spec 04
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `packages/configurator/src/shell/`, `packages/configurator/src/shared/`, `specs/inventory/16-configurator-shell.md`
**Reuses:** `packages/rx-core/src/index.ts` (spec 03), `packages/configurator/src/styles/` (spec 04), `packages/configurator/src/test/` (spec 04), `design/v3/product.html`, `DESIGN-SYSTEM.md#layout-conventions`, `DESIGN-SYSTEM.md#states-and-motion`
**Kind:** ui, logic
**Invariants:** INV-7, INV-9

## Goal

The `<lens-configurator>` custom element: Shadow DOM, modal on desktop / bottom sheet on mobile, step
progress, Back/Continue footer with the running total slot, a reducer that owns all configurator state,
and a typed client for the app proxy — so each step spec only adds a folder.

## Scope

- Custom element registered by `configurator.ts`; reads the mount point's `data-product-json` and
  `data-proxy`; opens on the loader's event; Escape and backdrop close; focus trapped while open, returned
  to the button on close; body scroll locked.
- Step discovery: `import.meta.glob('../steps/*/index.tsx')`, ordered by folder prefix; each step module
  exports `{ id, titleKey, isComplete(state), isApplicable(state), Component, Summary? }`; the shell renders a
  step's optional `Summary` in the footer's running-total slot (empty when absent). Steps not applicable
  (e.g. prescription for `NON_PRESCRIPTION`) are skipped by Back/Continue and the progress bar.
- Reducer: state = `{ stepIndex, rxType, prescription, prescriptionRef, catalog, selection, status }`;
  actions are a closed union; Continue disabled until the current step's `isComplete`.
- API client (`shared/api.ts`): `getCatalog(productId)`, `submitPrescription(body)`, `getUploadUrl(file)`,
  `uploadFile(url, file)`, using the proxy base; parses every response with spec 03 schemas; maps errors
  to `{ code }`. Injected into steps via a context (DI only).
- Loading, error (with Retry) and empty-catalog states for the whole sheet.
- `shared/strings.ts` for shell strings; `shared/format.ts` for money via `Intl.NumberFormat`.

## Explicit non-scope

- Step contents → specs 26–29. Proxy endpoints → specs 21, 22. Add to cart → spec 29.

## Reuse first

- Named in detail: rx-core types and schemas (spec 03), `tokens.css` + `renderInShadow` (spec 04), `design/v3/product.html`, `DESIGN-SYSTEM.md#layout-conventions`, `DESIGN-SYSTEM.md#states-and-motion`
- spec 03 schemas for parsing responses — do not write a second validator.
- spec 04 tokens and `renderInShadow` for tests.

## Wiring

Real, used now: proxy client calls real URLs at runtime. Tests: a fake fetch.
Stubbed until later specs — test code only: step folders (tests use fixture steps). In production, with no
step folders the shell shows the empty-catalog message, never a blank sheet.

## Examples

| State / event | Expected | Why this row |
| --- | --- | --- |
| open, catalog loads | step 1, Back hidden | normal |
| Continue on incomplete step | button disabled, no transition | gating |
| rxType `NON_PRESCRIPTION`, Continue from step 1 | skips prescription step | applicability |
| catalog request 500 | error state with Retry; Retry refetches | failure |
| catalog with zero lens groups | empty state, close button | empty |
| Escape while open | closes, focus back on the trigger | a11y |
| viewport 375 px | bottom sheet, sticky footer, no horizontal scroll | layout |

## Steps

1. Element + Shadow DOM + open/close/focus; 2. reducer with tests; 3. step discovery; 4. API client.

## Self-check

1. Focus trap releases on close and on disconnect (element removed while open).
2. The reducer is pure: no fetch inside it; effects live in the shell.
3. Reduced motion: sheet open/close has the still alternative from DESIGN-SYSTEM.
4. UI + logic checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run packages/configurator/src/shell` passes: every Examples row is a case, asserted by role and text. [unit]
- [ ] Reducer test: every action on every state is covered by a table, and Continue is impossible while `isComplete` is false. [unit]
- [ ] API client test: a response failing the spec 03 schema becomes `{ code: "BAD_RESPONSE" }`, never a thrown TypeError in the UI. [unit]
- [ ] INV-7: the raw-value `rg` from INVARIANTS.md finds nothing in `src/shell` and `src/shared`. [static]
- [ ] INV-9: no JSX text literal in `src/shell` (`rg` for `>[A-Za-z]` in `.tsx` finds only strings-file references). [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/16-configurator-shell.md` lists the step module contract, reducer actions, API client. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
