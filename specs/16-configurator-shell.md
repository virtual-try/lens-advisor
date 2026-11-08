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
  - `pnpm vitest run packages/configurator/src/shell`: 4 test files, 121 tests passed (every Examples row verified by role and text).
  - `pnpm vitest run packages/configurator/src/shell/reducer.test.ts`: 97 tests passed (table covering every action on every status).
  - `pnpm vitest run packages/configurator/src/shared/api.test.ts`: 15 tests passed (`BAD_RESPONSE` on schema failure, HTTP errors, uploads, File/Blob inputs).
  - INV-7: `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' packages/configurator/src/shell packages/configurator/src/shared --glob '!tokens.css'` found 0 matches.
  - INV-9: `rg '>[A-Za-z]' packages/configurator/src/shell --glob '*.tsx'` found 0 matches.
  - `pnpm test`: 37 test files passed, 584 tests passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (`--max-warnings 0`).
  - `pnpm build`: exit 0 (`loader.js` 1314 B <= 10 KB limit; `configurator.js` 96395 B; `loader.css` 3273 B).
  - `git diff --check`: clean (exit 0).
- **2026-11-08** — Evidence (orchestro spec verify): install pass · typecheck pass · lint pass · build pass · test pass 584/0/0
- **2026-11-08** — Review R1 fixes implemented by agy-3:
  - **R1-F1** [BLOCKER]: Updated `formatMoney` in `packages/configurator/src/shared/format.ts` to derive divisor from `Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits`. Tested 0-, 2-, and 3-decimal currencies (`JPY 12900 -> 12,900`, `USD 12900 -> 129.00`, `KWD 12900 -> 12.900`).
  - **R1-F2** [BLOCKER]: Fixed focus trap inside Shadow DOM in `packages/configurator/src/shell/trap.ts` to read active element from `(container.getRootNode() as Document | ShadowRoot)?.activeElement ?? document.activeElement`. Added test verifying Tab and Shift+Tab cycling through `renderInShadow`.
  - **R1-F3** [BLOCKER]: Made viewport 375px layout test discriminating in `packages/configurator/src/shell/shell.test.tsx` by asserting exact mobile media query rules applied (bottom-sheet placement `.la-overlay` `align-items: flex-end`, `padding: 0`; `.la-sheet` `max-width: 100%`, `border-bottom-left-radius: 0`; sticky footer `.la-footer` `position: sticky`, `bottom: 0`; and no horizontal overflow `.la-body` `overflow-x: hidden`). Verified sabotage: commenting out `@media (max-width: 40rem)` turned the test RED (`AssertionError: expected 0 to be greater than 0`).
  - **R1-F4** [BLOCKER]: Expanded `packages/configurator/src/shell/reducer.test.ts` matrix to assert behavior-specific expected state for every action across every status. Verified sabotage: commenting out `case "SET_LENS":` turned 5 matrix tests RED (`AssertionError: expected undefined to be 'lens-1'`).
  - **R1-F5** [BLOCKER]: Made `LensConfiguratorElement` the single scroll-lock owner in `packages/configurator/src/entries/configurator.ts`, capturing pre-existing `document.body.style.overflow` before writing `"hidden"` and restoring exact prior value on close and disconnect. Passed `lockScroll: false` from `ConfiguratorApp`. Added test verifying prior `body.style.overflow = "clip"` is preserved on close and disconnect.
  - **R1-F6** [MAJOR]: Added generic localized fallback `strings.header.defaultTitle = "Choose your lenses"` in `packages/configurator/src/shared/strings.ts` and updated `Header.tsx` to use it when `productTitle` is absent while preserving `${strings.header.titlePrefix}${productTitle}` when present. Tested both cases in `shell.test.tsx`.
  - **R1-F7** [MAJOR]: Updated `reducer.ts` on `CATALOG_LOADED` to select the first applicable step (`steps.findIndex((s) => s.isApplicable(nextState))`) and maintain step index on an applicable step whenever applicability changes (`keepStepApplicable`). Ensured active component in `ConfiguratorApp.tsx` is applicable. Tested with step 0 inapplicable.
  - **R1-F8** [MAJOR]: Added exiting phase before unmount on close (Escape, backdrop click, Close button) in `ConfiguratorApp.tsx` with exit animation keyframes (`la-modal-exit`, `la-overlay-exit`, `la-sheet-exit`) and still/fade transitions (`la-fade-enter`, `la-fade-exit`) under `prefers-reduced-motion: reduce` as specified in `DESIGN-SYSTEM.md`. Tested phase sequence.
  - **R1-F9** [MAJOR]: Set `inert` and fallback `aria-hidden="true"` on host's body siblings while modal is open, and restored exact prior state on close and disconnect. Tested in `shell.test.tsx`.
  - **R1-F10** [MAJOR]: Added test in `shell.test.tsx` holding `getCatalog` pending with a deferred promise, asserting `role="status"`, `aria-busy="true"`, and localized loading strings before resolving.
  - **R1-F11** [MAJOR]: Wrapped body-stream reading (`response.text()`) in try-catch in `packages/configurator/src/shared/api.ts`, mapping body-read failures to `new ApiError({ code: "NETWORK_ERROR" })`. Added regression test in `api.test.ts`.
  - **R1-F12** [MAJOR]: Replaced raw `25rem` in `.la-view-desc` in `shell.css` with approved token `var(--la-drawer-max)`. Follow-up recorded: if design requires a dedicated `400px` max-width distinct from `--la-drawer-max` (420px), a token such as `--la-view-desc-max` should be added to `DESIGN-SYSTEM.md` and `tokens.css` in a future spec.
- **2026-11-08** — Review R2 fixes implemented by agy-3:
  - **R2-F1** [BLOCKER]: Removed duplicate `la:open` listener from `LensConfiguratorElement.connectedCallback` in `packages/configurator/src/entries/configurator.ts`, keeping single module-level subscription via `ensureConfigurator`. Made `open()` idempotent when already open and captured `prevBodyOverflow` only on closed→open transition. Added regression tests in `configurator.test.ts` for idempotent `open()`, multi-reopen scroll restoration, and lazy-loading with `data-la-state="open"`.
  - **R2-F2** [BLOCKER]: Replaced hardcoded `250` millisecond exit delay in `packages/configurator/src/shell/ConfiguratorApp.tsx` by deriving duration from motion tokens (`--la-dur-fast` 150ms desktop, `--la-dur-modal` 250ms mobile) parsed from `tokens.css` (INV-7 compliant) and listening for `animationend`/`animationcancel` on the sheet for immediate unmount upon animation completion.
  - **R2-F3** [BLOCKER]: Updated `packages/configurator/src/shell/shell.test.tsx` to explicitly test `prefers-reduced-motion: reduce` using mocked `matchMedia`, asserting immediate unmount without exit delay and synchronous focus return, and verifying exact still/fade styles in `shell.css`. Renamed existing test to reflect its coverage.
  - **R2-F4** [BLOCKER]: Kept focus trap continuously active through exiting animation phase in `packages/configurator/src/shell/ConfiguratorApp.tsx` and `packages/configurator/src/shell/trap.ts`, ensuring focus does not escape or return to inert trigger while sheet is exiting. Restored focus to trigger only after sheet unmounts. Added tests asserting focus remains trapped inside dialog during exit and returns to trigger upon unmount.
- **2026-11-08** — Review R3 fixes implemented by agy-3:
  - **R3-F1** [BLOCKER]: Re-ran all Done-when command gates on the current head and updated the spec Log with real test counts and asset sizes (`packages/configurator/src/shell`: 4 test files, 121 tests; `reducer.test.ts`: 97 tests; `api.test.ts`: 15 tests; `types.test.ts`: 8 tests; `configurator.test.ts`: 10 tests; full suite: 37 test files, 584 tests, 0 failures; typecheck pass; lint pass; build pass: `loader.js` 1314 B, `configurator.js` 96395 B).
  - **R3-F2** [BLOCKER]: Added `productVariantDataSchema`, `productDataSchema`, and `parseProductData` in `packages/configurator/src/shared/types.ts` using Zod to parse and normalise numeric Shopify IDs to strings at the boundary (`packages/configurator/src/entries/configurator.ts`), falling back to undefined (no-product state) on malformed JSON or schema failure. Updated `ConfiguratorApp.tsx` to safely normalize product inputs. Added comprehensive unit tests in `types.test.ts`, integration tests in `configurator.test.ts`, and a shell test in `shell.test.tsx` asserting `state.selection.frameVariantId` conforms to spec 03 `selectionSchema` when mounted with the literal liquid block payload shape.
  - **R3-F3** [BLOCKER]: Extended `getUploadUrl` in `packages/configurator/src/shared/api.ts` to accept `File` or `Blob` instances, extracting `{ contentType: file.type, size: file.size }` (and optional `draftId`), while preserving the `UploadUrlRequest` DTO overload. Added regression tests in `api.test.ts` for `File` with mime type mapping, `Blob` upload URL requests, DTO requests, and validation error on empty file type.
- **2026-11-08** — Review R4 fixes implemented by agy-3:
  - **R4-F1** [BLOCKER]: Added `--la-sheet-max-height: 90vh` token to `packages/configurator/src/styles/tokens.css` and documented it in `specs/DESIGN-SYSTEM.md` layout conventions table to preserve INV-7's closed token system. Replaced raw `max-height: 90vh` in `packages/configurator/src/shell/shell.css:44` with `max-height: var(--la-sheet-max-height);`. Added unit test asserting usage of the token and absence of raw `90vh`.
  - **R4-F2** [BLOCKER]: Mapped `ApiError` code `NOT_AVAILABLE` (from 404 response on uninstalled or inactive-plan shop) to spec 16's empty state without a Retry button in `packages/configurator/src/shell/ConfiguratorApp.tsx` and `packages/configurator/src/shell/reducer.ts`, preserving other error codes as retryable errors with Retry button. Added regression tests in `reducer.test.ts` and `shell.test.tsx` verifying empty state on `NOT_AVAILABLE` (with Close button, no Retry button) and retryable error state on other codes (with Retry button).
- **2026-11-08** — Review R5 fixes implemented by agy-3:
  - **R5-F1** [BLOCKER]: Added `--la-z-footer: 10` token to `packages/configurator/src/styles/tokens.css` and documented it in `specs/DESIGN-SYSTEM.md` elevation table. Replaced raw `z-index: 10` in `packages/configurator/src/shell/shell.css:391` with `z-index: var(--la-z-footer);` and swept `shell.css` for any other raw z-index (verified none remain). Added unit test asserting usage of `--la-z-footer` and absence of raw z-index numbers.
  - **R5-F2** [BLOCKER]: Updated Row 6 Escape test in `packages/configurator/src/shell/shell.test.tsx` to assert localized header text (`Lenses for Harlow`) is present before Escape, and that both the dialog (`queryByRole("dialog")`) and localized header text (`queryByText(...)`) are null after exit completes.
  - **R5-F3** [MAJOR]: Replaced `font-family: var(--la-font-numeric);` on `.la-total` in `packages/configurator/src/shell/shell.css:189` with `font-variant-numeric: var(--la-font-numeric);` so running totals receive tabular numerals while font stack inherits `--la-font-family`. Added CSS regression test asserting `font-variant-numeric: var(--la-font-numeric)` is applied and `--la-font-numeric` is not assigned to `font-family`.
- **2026-11-08** — Evidence (orchestro spec verify): typecheck pass · lint pass · build pass (`loader.js` 1314 B, `configurator.js` 96779 B) · test pass 596/0/0
- **2026-11-08** — Evidence (orchestro spec verify, tree 5937e623): install pass · typecheck pass · lint pass · build pass · test pass 596/0/0
