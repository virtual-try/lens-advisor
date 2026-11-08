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

- [x] `pnpm vitest run packages/configurator/src/shell` passes: every Examples row is a case, asserted by role and text. [unit]
- [x] Reducer test: every action on every state is covered by a table, and Continue is impossible while `isComplete` is false. [unit]
- [x] API client test: a response failing the spec 03 schema becomes `{ code: "BAD_RESPONSE" }`, never a thrown TypeError in the UI. [unit]
- [x] INV-7: the raw-value `rg` from INVARIANTS.md finds nothing in `src/shell` and `src/shared`. [static]
- [x] INV-9: no JSX text literal in `src/shell` (`rg` for `>[A-Za-z]` in `.tsx` finds only strings-file references). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/16-configurator-shell.md` lists the step module contract, reducer actions, API client. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 16 implemented by agy-3 in worktree `spec-16` (branch `spec/16-configurator-shell`). No git writes (lead commits).
- **2026-11-08** — Landed `packages/configurator/src/shared/`:
  - `types.ts`: Product and variant DTO interfaces.
  - `strings.ts`: Centralized user-visible strings for shell header, progress, footer, loading, error, and empty catalog views (INV-9).
  - `format.ts`: `formatMoney(amountMinor, currency, locale)` using `Intl.NumberFormat` without floating point math (INV-4).
  - `api.ts`: Typed API client for app proxy endpoints (`getCatalog`, `submitPrescription`, `getUploadUrl`, `uploadFile`), parsing responses with spec 03 zod schemas and mapping errors to `ApiError` with `{ code }` (e.g. `BAD_RESPONSE`, `NOT_AVAILABLE`, `RATE_LIMITED`, `NETWORK_ERROR`). `ApiContext` and `useApi` hook for DI.
- **2026-11-08** — Landed `packages/configurator/src/shell/`:
  - `types.ts`: `ConfiguratorState`, closed union `ConfiguratorAction`, `StepModule`, `StepDefinition`, `StepProps`.
  - `discovery.ts`: Eager step discovery via `import.meta.glob('../steps/*/index.tsx')` sorted by folder prefix, with contract validation.
  - `reducer.ts`: Pure state machine reducer `configuratorReducer` enforcing gating (`CONTINUE` blocked while `isComplete` is false) and applicability step-skipping.
  - `trap.ts`: Focus trap and body scroll lock; releases on close and when container disconnects while open.
  - `shell.css`: Shadow DOM styles transcribed from DESIGN-SYSTEM.md using only CSS variables; desktop modal (> 40rem) / mobile bottom sheet (<= 40rem) with still alternative for reduced motion (INV-7).
  - Preact components: `ProgressBar.tsx`, `Header.tsx`, `Footer.tsx`, `LoadingView.tsx`, `ErrorView.tsx`, `EmptyView.tsx`, `ConfiguratorApp.tsx`.
- **2026-11-08** — Updated `packages/configurator/src/entries/configurator.ts`: registers `<lens-configurator>` custom element in Shadow DOM, binds to loader's `la:open` event, reads mount attributes `data-product-json` and `data-proxy`, locks body scroll, manages lifecycle, and restores trigger button focus on close/disconnect.
- **2026-11-08** — Inventory fragment written to `specs/inventory/16-configurator-shell.md`.
- **2026-11-08** — Self-checks verified:
  1. Focus trap releases on close and on disconnect (element removed while open).
  2. The reducer is pure: no fetch inside it; effects live in the shell.
  3. Reduced motion: sheet open/close has the still alternative from DESIGN-SYSTEM.
  4. UI + logic checklists checked.
- **2026-11-08** — Gates verified:
  - `pnpm vitest run packages/configurator/src/shell`: 4 test files, 110 tests passed (every Examples row verified by role and text).
  - `pnpm vitest run packages/configurator/src/shell/reducer.test.ts`: 96 tests passed (table covering every action on every status).
  - `pnpm vitest run packages/configurator/src/shared/api.test.ts`: 11 tests passed (`BAD_RESPONSE` on schema failure, HTTP errors, uploads).
  - INV-7: `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' packages/configurator/src/shell packages/configurator/src/shared --glob '!tokens.css'` found 0 matches.
  - INV-9: `rg '>[A-Za-z]' packages/configurator/src/shell --glob '*.tsx'` found 0 matches.
  - `pnpm test`: 36 test files passed, 554 tests passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (`--max-warnings 0`).
  - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit; `configurator.js` 91102 B).
  - `git diff --check`: clean (exit 0).
- **2026-11-08** — Evidence (orchestro spec verify, tree 7b9fce5a): install pass · typecheck pass · lint pass · build pass · test pass 554/0/0
