# Inventory fragment — Spec 16 (Configurator shell, state machine and API client)

### `configurator-element`
`packages/configurator/src/entries/configurator.ts` & `packages/configurator/src/shared/types.ts` — Registers the `<lens-configurator>` custom element (`LENS_CONFIGURATOR_TAG`). Attaches an open Shadow DOM, binds to the `la:open` storefront event dispatched by the loader, reads mount attributes `data-product-json` and `data-proxy`, parses and normalises `data-product-json` via `productDataSchema` (normalising numeric Shopify IDs to strings and falling back to no-product state on invalid JSON or schema failure), and renders `<ConfiguratorApp />` in shadow DOM. Body scroll is locked while open, and focus is returned to the trigger button on close or when removed from DOM (disconnect).
**Use instead of:** Registering a custom element in another module or managing storefront configurator mounting manually.
**Added by:** spec 16.

### `configurator-shell-app`
`packages/configurator/src/shell/ConfiguratorApp.tsx` — Main Preact component for the shell. Manages the state machine via `useReducer`, controls dialog open/close lifecycle, sets up the focus trap (`createFocusTrap`) and Escape/backdrop handlers, fetches the catalog on open via `api.getCatalog`, and renders modal layout on desktop (> 40rem) / bottom sheet on mobile (<= 40rem). Renders `LoadingView`, `ErrorView` (with Retry), `EmptyView` (with close), and active step views with sticky `Header` and `Footer`.
**Use instead of:** Writing custom modal containers or embedding step views outside the shell.
**Added by:** spec 16.

### `configurator-step-contract`
`packages/configurator/src/shell/types.ts` & `packages/configurator/src/shell/discovery.ts` — Defines the step module contract and eager discovery mechanism. Each step module exports `{ id, titleKey, isComplete(state), isApplicable(state), Component, Summary? }`. `loadDiscoveredSteps` discovers steps via `import.meta.glob('../steps/*/index.tsx')` sorted by folder prefix (e.g. `01-vision`, `02-prescription`). Steps not applicable (such as prescription for `NON_PRESCRIPTION`) are skipped by Back/Continue and the progress bar.
**Use instead of:** Hardcoding step lists or registering steps through global singletons.
**Added by:** spec 16.

### `configurator-reducer`
`packages/configurator/src/shell/reducer.ts` — Pure state machine reducer `configuratorReducer(state, action, steps)` and initial state factory `createInitialState(frameVariantId)`. State shape: `{ stepIndex, rxType, prescription, prescriptionRef, catalog, selection, status, error, isOpen }`. Actions are a closed union: `OPEN`, `CLOSE`, `CATALOG_LOADING`, `CATALOG_LOADED`, `CATALOG_ERROR`, `SET_RX_TYPE`, `SET_PRESCRIPTION`, `SET_PRESCRIPTION_REF`, `SET_LENS`, `SET_OPTIONS`, `TOGGLE_OPTION`, `SET_ADDONS`, `TOGGLE_ADDON`, `CONTINUE`, `BACK`, `GO_TO_STEP`, `RESET`. Enforces gating: `CONTINUE` is impossible while the current step's `isComplete(state)` is false.
**Use instead of:** Mutating configurator state directly or performing side effects inside reducers.
**Added by:** spec 16.

### `configurator-api-client`
`packages/configurator/src/shared/api.ts` — Typed HTTP client for the app proxy. Methods: `getCatalog(productId)`, `submitPrescription(body)`, `getUploadUrl(file)`, `uploadFile(url, file)`. `getUploadUrl` accepts browser `File`/`Blob` instances (mapping `type` to `contentType` and `size`) and preserves the DTO overload (`UploadUrlRequest`). Parses responses with spec 03 schemas (`catalogResponseSchema`, etc.). Maps network, HTTP, and schema validation failures to `ApiError` with `{ code }` (e.g. `BAD_RESPONSE`, `NOT_AVAILABLE`, `RATE_LIMITED`, `NETWORK_ERROR`). Injected into steps via `ApiContext` and `useApi` hook (DI only).
**Use instead of:** Raw `fetch` calls or unvalidated response access.
**Added by:** spec 16.

### `configurator-focus-trap`
`packages/configurator/src/shell/trap.ts` — `createFocusTrap({ container, trigger, onEscape })`. Locks body scroll (`overflow: hidden`) on activate, loops Tab and Shift+Tab navigation within focusable elements, triggers `onEscape` on Escape key, and releases scroll lock and returns focus to `trigger` on deactivate or disconnect.
**Use instead of:** Third-party focus trap libraries or un-trapped modals.
**Added by:** spec 16.

### `configurator-strings`
`packages/configurator/src/shared/strings.ts` — Storefront strings for header, progress, footer, loading, error, and empty views. Complies with INV-9: all user-visible text in the shell is referenced from this file.
**Use instead of:** Inline string literals in JSX.
**Added by:** spec 16.

### `configurator-money-format`
`packages/configurator/src/shared/format.ts` — `formatMoney(amountMinor, currency, locale)`. Formats integer minor units via `Intl.NumberFormat`. Complies with INV-4: no float arithmetic on money.
**Use instead of:** `toFixed` or `parseFloat` on monetary values.
**Added by:** spec 16.
