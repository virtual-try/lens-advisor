# Inventory — what already exists

**Check this before creating any component, hook, constant, type, or util.**
If a near match exists, extend it. Creating a second one is a review failure.

This file is maintained by folding fragments from `specs/inventory/NN-<slug>.md`.
Folded by Spec 34 (Verification pass).

Entry shape — three lines, with a stable anchor so specs can cite
`INVENTORY.md#<anchor>`:

```markdown
### `<anchor-name>`
`<path>` — <one-line purpose>
**Use instead of:** <what not to build>
**Added by:** spec NN.
```

## Components (admin — Polaris)

### `admin-home-view`
`app/features/home/home-view.tsx` — `HomeView` component rendering the setup checklist and "You're live" card using Polaris web components without custom CSS.
**Use instead of:** ad-hoc setup checklist UI in admin routes.
**Added by:** spec 31.

### `lab-orders-status-badge`
`app/features/lab-orders-admin/status-badge.tsx` — `renderStatusBadge`, `LabOrderStatusBadge`:
- Shared badge component for status display across list and detail routes; maps FAILED status to plain English sentence via error table or "Something went wrong" when code is null/empty (R1-F5).
**Use instead of:** Duplicating status badge rendering between routes.
**Added by:** spec 32.

### `LensForm`
`app/features/catalog/components/lens-form.tsx` — Reusable Polaris form component for creating and editing lenses.
- Provides text inputs for SPH, CYL, and ADD limits parsed using `parseDiopterText` (spec 10), supporting minus signs, decimal commas, and plano.
- Validates limits order (`sphMin <= sphMax`, `cylMin <= cylMax`, `addMin <= addMax`), displaying inline `LIMITS_INVERTED` errors and disabling save.
- Validates lab-code template via `validateTemplate` (spec 12), displaying inline errors (e.g. `UNCLOSED_TOKEN`, `EMPTY_TEMPLATE`) and disabling save when invalid.
- Generates live preview of default lab code using `compileLabCode(template, [])` (spec 12).
- Renders confirmation modal (`<s-modal>`) before archiving lenses.
- Uses Polaris web components only with zero custom styles or classes (INV-7).
**Use instead of:** raw form elements or unvalidated inputs for lens editing.
**Added by:** spec 18.

### `OptionValueForm`
`app/features/catalog/components/option-value-form.tsx` — Polaris web-component form component for creating and editing option values. Accepts label, price delta, code source (token key=VALUE or override code), and swatch colour for COLOR groups. Displays inline validation errors.
**Use instead of:** duplicating option value form markup across admin screens.
**Added by:** spec 19.


## Components (configurator — Preact)

### `addons-step`
`packages/configurator/src/steps/06-add-ons/index.tsx` & `packages/configurator/src/steps/06-add-ons/AddOnsStep.tsx` — Configurator Step 6 module exporting `{ id: "add-ons", titleKey, isComplete, isApplicable, Component, Summary: PriceSummary }`. Renders optional add-ons as checkbox choice cards in catalog order. Zero add-ons are pre-ticked on first render (dark-pattern guard). Ticking and unticking add-ons toggles their IDs in `selection.addOnIds`, updating the running price summary. Always complete (`isComplete = () => true`).
**Use instead of:** Custom add-on toggles or pre-selected add-on checkboxes.
**Added by:** spec 28.

### `configurator-option-card`
`packages/configurator/src/steps/03-lens-group/OptionCard.tsx` — Shared choice-card component (`OptionCard`) implementing the DESIGN-SYSTEM.md choice card pattern. Renders a radio input with accessible touch target (min 44 px via `--la-target`), custom checkmark (`.la-mark`), title, optional badge, optional description, price, and accessible disabled reason line (`.la-choice__reason` with `aria-hidden="true"` and linked `aria-describedby`). Supports reduced-motion overrides. Styles adhere strictly to `tokens.css` with zero raw values (INV-7).
**Use instead of:** Writing custom radio/choice card markup in configurator steps.
**Added by:** spec 27.

### `configurator-shell-app`
`packages/configurator/src/shell/ConfiguratorApp.tsx` — Main Preact component for the shell. Manages the state machine via `useReducer`, controls dialog open/close lifecycle, sets up the focus trap (`createFocusTrap`) and Escape/backdrop handlers, fetches the catalog on open via `api.getCatalog`, and renders modal layout on desktop (> 40rem) / bottom sheet on mobile (<= 40rem). Renders `LoadingView`, `ErrorView` (with Retry), `EmptyView` (with close), and active step views with sticky `Header` and `Footer`.
**Use instead of:** Writing custom modal containers or embedding step views outside the shell.
**Added by:** spec 16.

### `configurator-step-contract`
`packages/configurator/src/shell/types.ts` & `packages/configurator/src/shell/discovery.ts` — Defines the step module contract and eager discovery mechanism. Each step module exports `{ id, titleKey, isComplete(state), isApplicable(state), Component, Summary? }`. `loadDiscoveredSteps` discovers steps via `import.meta.glob('../steps/*/index.tsx')` sorted by folder prefix (e.g. `01-vision`, `02-prescription`). Steps not applicable (such as prescription for `NON_PRESCRIPTION`) are skipped by Back/Continue and the progress bar.
**Use instead of:** Hardcoding step lists or registering steps through global singletons.
**Added by:** spec 16.

### `configurator-step-lens`
`packages/configurator/src/steps/04-lens/index.tsx` — Step 4 of the storefront configurator (`id: "lens"`, `titleKey: "lens"`). Displays lenses belonging to the chosen group (`state.lensGroupId`) as radio cards with formatted prices. Evaluates optical availability using `filterLenses` against the in-memory prescription and `rxType`. Orders lenses with available lenses first (maintaining catalog order) followed by unavailable lenses (maintaining catalog order). Unavailable lenses use `aria-disabled="true"` with no native `disabled` attribute and reasons linked via `aria-describedby` (omitted from label text via `aria-hidden="true"`). Arrow keys in the radiogroup skip unavailable lenses and move focus to the newly selected radio. When every lens is unavailable, renders an explanation banner with a "Change prescription" button that dispatches `GO_TO_STEP` with `stepId: "prescription"`. Exports the standard `StepModule` contract (`id`, `titleKey`, `isComplete`, `isApplicable`, `Component`).
**Use instead of:** Ad-hoc lens selection views or unvalidated limit checks in the storefront.
**Added by:** spec 27.

### `configurator-step-lens-group`
`packages/configurator/src/steps/03-lens-group/index.tsx` — Step 3 of the storefront configurator (`id: "lens-group"`, `titleKey: "lens_group"`). Displays lens groups as cards with name, description, and "from <price>" derived from the minimum price among lenses supporting the shopper's prescription type (`rxType`). Automatically filters out groups with zero lenses for the active `rxType`. Selecting a group dispatches `SET_LENS_GROUP` to shell state (`state.lensGroupId`), enabling Continue in the shell footer. Arrow keys update selection and move focus (`document.activeElement`). Exports the standard `StepModule` contract (`id`, `titleKey`, `isComplete`, `isApplicable`, `Component`).
**Use instead of:** Hardcoded group selection components or unfiltered group listings.
**Added by:** spec 27.

### `configurator-step-prescription`
`packages/configurator/src/steps/02-prescription/index.tsx` & `PrescriptionStep.tsx` — Step 2 of the storefront configurator. Skipped when `rxType === "NON_PRESCRIPTION"`. Provides "Type it in" manual diopter entry and "Upload a photo" tabs, each toggled based on the shop's catalog settings (`manualRxEnabled` and `rxUploadEnabled`).
- **Manual grid:** OD/OS table with SPH, CYL, AXIS, ADD (ADD only visible for `PROGRESSIVE` and `READING`), and PD (single or dual OD/OS). Inputs are validated on blur using spec 10 (`parseSphText`, `parseCylText`, `parseAxis`, `parseAddText`, `parsePd`), displaying inline error messages below each field linked via `aria-describedby` and visible row labels via `aria-labelledby`. Supports "Same as right eye? Copy to left" quick-fill (copying SPH, CYL, AXIS, and ADD) and the "What do these numbers mean?" help disclosure. Mobile layout at 375 px stacks row labels above inputs without horizontal scroll.
- **Upload panel:** Pick/drag file or camera capture (`accept`, `capture`) supporting JPEG, PNG, HEIC, and PDF up to 10 MB. Preflight checks reject oversized or invalid files locally with no API call. Performs presigned upload via `api.getUploadUrl` and `api.uploadFile`, displays upload progress, and renders a removable file chip with formatted file size.
- **Continue & submission:** Submits via `api.submitPrescription`. Server 400 validation error paths (e.g. `od.axis`) map back to the respective field errors. Upon successful submission, stores `rxRef` in configurator state and advances.
Exports the step module contract `{ id: "prescription", titleKey: "Prescription", isComplete(state), isApplicable(state), Component }`.
**Use instead of:** Custom prescription input forms or direct unvalidated file uploads.
**Added by:** spec 26.

### `configurator-step-rx-type`
`packages/configurator/src/steps/01-rx-type/index.tsx` & `RxTypeStep.tsx` — Step 1 of the storefront configurator. Renders four vision need options (`SINGLE_VISION`, `PROGRESSIVE`, `READING`, `NON_PRESCRIPTION`) as large accessible radio cards with pictograms, one-line descriptions, and "from <lowest lens price>" computed dynamically from `catalog.lensGroups`. Types with no lenses in the catalog are automatically hidden. Includes the "Not sure which one you need?" clinical help disclosure. Exports the step module contract `{ id: "rx-type", titleKey: "Vision", isComplete(state), isApplicable(state), Component }`.
**Use instead of:** Hardcoding Rx type cards or computing lens tier prices manually.
**Added by:** spec 26.

### `lens-configurator-tag`
`packages/configurator/src/entries/configurator.ts` — Exports `LENS_CONFIGURATOR_TAG` (`lens-configurator`) and registers an empty custom element so the built script is not a no-op. Spec 16 fills the element.
**Use instead of:** Defining `<lens-configurator>` in another file, or a second custom-element tag.
**Added by:** spec 04.

### `options-step`
`packages/configurator/src/steps/05-options/index.tsx` & `packages/configurator/src/steps/05-options/OptionsStep.tsx` — Configurator Step 5 module exporting `{ id: "options", titleKey, isComplete, isApplicable, Component, Summary: PriceSummary }`. Renders one radio group per option group in catalog order. Colour groups (`group.kind === "COLOR"` or options with `swatch`) render as swatches with visible text names and `--la-swatch-color` inline custom properties. Other groups render as choice cards. Price deltas render as `+${price}` or "Included". Automatically preselects the first option value only when its delta is 0; otherwise leaves the group unselected and enforces group completion before Continue is enabled.
**Use instead of:** Hand-crafted option group pickers or non-token swatch components.
**Added by:** spec 28.

### `price-summary`
`packages/configurator/src/price-summary/PriceSummary.tsx` & `packages/configurator/src/price-summary/index.ts` — Preact component for displaying price breakdowns and running totals calculated via `priceSelection(selection, catalog, framePrice)` from `packages/rx-core/src/pricing/`. Supports `compact` (footer running total with itemized lines and live total amount) and `expanded` (sheet / review itemized list) variants. Resolves frame price from explicit props, parsed product data, or active mount `data-product-json`, returning `null` if unavailable. Formats integer minor units via `formatMoney` with zero-delta values displayed as "Included". Reused by step 5, step 6, step 7 (review), and footer.
**Use instead of:** Writing custom price calculators or duplicating price breakdown display logic.
**Added by:** spec 28.

### `review-step`
`packages/configurator/src/steps/07-review/index.tsx` & `packages/configurator/src/steps/07-review/ReviewStep.tsx` — Configurator Step 7 module exporting `{ id: "review", titleKey: "review", isComplete: () => true, isApplicable: () => true, Component: ReviewStep }`. Displays a complete itemized review of the shopper's choices: Frame (title, variant/sub, formatted price), Vision (rxType, description, Edit button), Prescription (summary without values when `storeRxInOrder` is off per INV-3; "Non-prescription" for plain lenses; full prescription table when on; Edit button hidden when Rx step does not apply), Lens (name, description, price, Edit button), Options (selected option labels, deltas summary, total price, Edit button), and Extras (selected add-ons, price, Edit button). Edit buttons dynamically resolve step indices by step ID from registered steps. Reassurance notice reminds shopper that opticians check prescriptions before manufacturing. Renders expanded `PriceSummary` itemized breakdown. Renders primary button `"Add to cart — $235.00"` where the total is strictly derived from `priceSelection` (Self-check 3, INV-4), and disables button with price-unavailable message when total cannot be computed. Double-click protected (button disabled and `aria-busy` during submission). On add failure, maps `AddBundleError.code` to distinct localized error messages in an accessible alert banner (`role="alert"`).
**Use instead of:** Custom review screens or non-standard add-to-cart buttons.
**Added by:** spec 29.

### `select-lenses-block`
`extensions/lens-configurator/blocks/select-lenses.liquid` — Product-template app block. The mount exposes `data-product-json` (product id, variant ids, price in minor units, currency), `data-proxy="/apps/lens-advisor"`, and `data-configurator-src`. Button text is `block.settings.button_label` when the merchant set one. The setting has no schema default, so a new block leaves it blank and the button uses `select_lenses.button_label` from `locales/en.default.json`. The schema keeps the `button_label` label translation key. Schema `javascript` loads `loader.js`; `stylesheet` loads `loader.css`. Settings write `--la-merchant-accent` and `--la-merchant-radius` on `.la-block`.
**Use instead of:** A hard-coded button label, a script tag in the Liquid body, or a second product mount.
**Added by:** spec 04.


## Hooks

<none yet>

## API / services

### `add-bundle`
`packages/configurator/src/cart/add-bundle.ts` & `packages/configurator/src/cart/index.ts` — Adds a configurator bundle to the Shopify cart as nested cart lines via the Cart AJAX API (`POST /cart/add.js`). Generates `bundleId` via `crypto.randomUUID()`. Posts the frame line first with bundle properties (`_bundle_id`, `_bundle_role: "frame"`), reads the returned line `key` from the response (Self-check 1), and then posts child lines (lens, each option value with a `shopifyVariantId`, and each add-on with a `shopifyVariantId`) with `parent_id` set to that frame line key. The lens line carries `_option_ids`, `_addon_ids`, `_rx_ref`, and prescription properties (`Prescription: "Prescription on file"` when `storeRxInOrder` is false; `_rx_od`/`_rx_os`/`_rx_pd` when true, per INV-3; omitted entirely for non-prescription orders). Zero-delta options without a variant (such as Clear tint) do not get a cart line; their ID is recorded in the lens line `_option_ids`. On any child failure (e.g. 422 sold out, 500, or network throw), rollback removes the frame line via `POST /cart/change.js` with quantity 0, preventing partial bundles (Self-check 2), and reports `rolledBack` truthfully with `ROLLBACK_FAILED` surfaced if rollback fails. Best-effort rollback also recovers orphan frame lines if frame response JSON or key is missing. Exports `getCartEndpoint` respecting `window.Shopify.routes.root`, `refreshCartOrRedirect` (navigates to `/cart` or invokes configured theme hook), `AddBundleError`, and `addBundle`.
**Use instead of:** Hand-crafted cart fetch calls, manual cart property building, or un-rolled-back multi-line adds.
**Added by:** spec 29.

### `admin-add-ons-id-route`
`app/routes/app.add-ons.$id.tsx` — Admin route for creating, updating, and archiving add-ons with money price validation and Shopify product synchronization.
**Use instead of:** hand-rolled add-on endpoints.
**Added by:** spec 19.

### `admin-lens-groups-id-route`
`app/routes/app.lens-groups.$id.tsx` — Admin route for creating (`$id = "new"`) and editing lens groups.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all reads and writes to session shop (INV-1).
- Validates group name uniqueness within the shop via `createLensGroup` / `updateLensGroup` (spec 14).
- Supports archiving groups via `archiveLensGroup`.
**Use instead of:** direct database manipulation for lens groups.
**Added by:** spec 18.

### `admin-lenses-id-route`
`app/routes/app.lenses.$id.tsx` — Admin route for creating (`$id = "new"`) and editing catalog lenses.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all mutations and lookups to session shop (INV-1).
- Validates limits using `parseDiopterText` (spec 10), price via `parseMoneyText` (spec 13), and lab-code template via `validateTemplate` (spec 12).
- Saves lens via `createLens` or `updateLens` (spec 14), then synchronizes immediately with Shopify via `syncItem` (spec 17).
- Preserves database save if Shopify sync fails, redirecting to list with sync-failed badge state (Self-check 2).
- Handles lens archiving via `archiveLens` and drafting the Shopify product via `archiveItem`.
**Use instead of:** manual lens creation or unvalidated catalog updates.
**Added by:** spec 18.

### `admin-lenses-index-route`
`app/routes/app.lenses._index.tsx` — Admin list page displaying catalog lens groups as sections and lenses within each group.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all queries and actions strictly to authenticated session shop (INV-1).
- Renders empty state with "Add lens group" button when no groups exist.
- Displays each lens with price, Rx types, limits summary formatted via `formatDiopter` (INV-5, e.g. "SPH −8.00 to +6.00"), and sync status badge ("Synced", "Not synced", or "Sync failed" with "Retry").
- Actions support idempotent sync retry (`retry-sync` calling `syncItem` from spec 17), lens archiving (`archive-lens` calling `archiveLens` and `archiveItem`), group archiving (`archive-group` calling `archiveLensGroup`), and reordering (`reorder-lenses`, `reorder-groups`).
- Uses Polaris web components exclusively with zero raw CSS or inline styles (INV-7).
**Use instead of:** direct database queries or ad-hoc admin list interfaces.
**Added by:** spec 18.

### `admin-options-id-route`
`app/routes/app.options.$id.tsx` — Admin route for creating, updating, and archiving option values with money delta validation, code exclusivity check (token vs override), swatch for colour groups, and Shopify product synchronization (sync on delta > 0, archive product and clear variant id on delta -> 0).
**Use instead of:** hand-rolled option value endpoints.
**Added by:** spec 19.

### `admin-options-route`
`app/routes/app.options._index.tsx` — Admin page displaying option groups (material/index, tint type, colour) with ordered values, and add-ons across three sections with empty and populated states, group creation, reordering, and sync status badges.
**Use instead of:** direct database manipulation or unrouted admin pages for options and add-ons.
**Added by:** spec 19.

### `admin-settings-route`
`app/routes/app.settings.tsx` — Settings page route (`loader`, `action`, default UI component). Manages lab email addresses, ticket format, manual and upload prescription inputs, the order privacy toggle (`storeRxInOrder`), and displays the current billing plan with a link to Shopify's managed pricing page. Enforces lab email limits at the route boundary before splitting: raw field at most 2,000 characters (`FIELD_TOO_LONG`) and at most 10 email addresses (`TOO_MANY_LAB_EMAILS`), returning canonical 400 without writing to database. Saves settings via `updateSettings` (spec 15), checks billing status via `requireActivePlan` (spec 09), enforces confirmation for storing prescriptions in Shopify orders (INV-3), scopes all reads and writes to the session shop (INV-1), and styles with Polaris web components only (INV-7).
**Use instead of:** configuring shop settings in ad-hoc routes or writing settings directly to the database.
**Added by:** spec 20.

### `app-uninstalled-route`
`app/routes/webhooks.app.uninstalled.ts` — Verifies `app/uninstalled`, sets `Shop.uninstalledAt` once, and deletes that shop's sessions. Catalog and prescription rows stay until `shop/redact`.
**Use instead of:** Deleting shop data from the uninstall webhook.
**Added by:** spec 25.

### `billing-config`
`app/shared/config.server.ts` — `getConfig().billing.appHandle` (also `getBillingConfig()`) reads the optional `SHOPIFY_APP_HANDLE` env var, defaulting to `lens-advisor`; this is the app handle used in the hosted pricing URL. Partner credentials (`partnerOrganizationId`, `partnerAccessToken`, `appGid`) are lazy config keys reading `PARTNER_ORGANIZATION_ID`, `PARTNER_API_ACCESS_TOKEN`, and `SHOPIFY_APP_GID`.
**Use instead of:** reading `process.env` from billing or route code.
**Added by:** spec 09.

### `catalog-repository`
`app/features/catalog/catalog.repository.server.ts` — `createCatalogRepository(prisma)` and `CatalogRepository` class, plus standalone functions:
- Lens Groups: `listLensGroups(shopId, options?)`, `getLensGroup(shopId, id)`, `createLensGroup(shopId, data)`, `updateLensGroup(shopId, id, data)`, `deleteLensGroup(shopId, id)`, `reorderLensGroups(shopId, ids)`
- Lenses: `listLenses(shopId, options?)`, `getLens(shopId, id)`, `createLens(shopId, data)`, `updateLens(shopId, id, data)`, `deleteLens(shopId, id)`, `reorderLenses(shopId, ids, groupId?)`
- Option Groups: `listOptionGroups(shopId, options?)`, `getOptionGroup(shopId, id)`, `createOptionGroup(shopId, data)`, `updateOptionGroup(shopId, id, data)`, `deleteOptionGroup(shopId, id)`, `reorderOptionGroups(shopId, ids)`
- Option Values: `listOptionValues(shopId, options?)`, `getOptionValue(shopId, id)`, `createOptionValue(shopId, data)`, `updateOptionValue(shopId, id, data)`, `deleteOptionValue(shopId, id)`, `reorderOptionValues(shopId, ids, optionGroupId?)`
- Add-Ons: `listAddOns(shopId, options?)`, `getAddOn(shopId, id)`, `createAddOn(shopId, data)`, `updateAddOn(shopId, id, data)`, `deleteAddOn(shopId, id)`, `reorderAddOns(shopId, ids)`
- Sync and Storefront: `markSynced(shopId, entity, id, variantId, productId?)`, `getStorefrontCatalogData(shopId)`
Prisma persistence layer for merchant lens catalog. Scopes every read and write to `shopId` (INV-1), provides atomic reordering in a single transaction, and performs soft-deletes via `archivedAt`.
**Use instead of:** direct Prisma queries on `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, or `AddOn` tables.
**Added by:** spec 14.

### `catalog-service`
`app/features/catalog/catalog.service.server.ts` — `createCatalogService(deps)` and `CatalogService` class, plus standalone functions:
- Lens Groups: `listLensGroups(shopId, options?)`, `getLensGroup(shopId, id)`, `createLensGroup(shopId, input)`, `updateLensGroup(shopId, id, input)`, `deleteLensGroup(shopId, id)`, `archiveLensGroup(shopId, id)`, `reorderLensGroups(shopId, ids)`
- Lenses: `listLenses(shopId, options?)`, `getLens(shopId, id)`, `createLens(shopId, input)`, `updateLens(shopId, id, input)`, `deleteLens(shopId, id)`, `archiveLens(shopId, id)`, `reorderLenses(shopId, ids, groupId?)`
- Option Groups: `listOptionGroups(shopId, options?)`, `getOptionGroup(shopId, id)`, `createOptionGroup(shopId, input)`, `updateOptionGroup(shopId, id, input)`, `deleteOptionGroup(shopId, id)`, `archiveOptionGroup(shopId, id)`, `reorderOptionGroups(shopId, ids)`
- Option Values: `listOptionValues(shopId, options?)`, `getOptionValue(shopId, id)`, `createOptionValue(shopId, input)`, `updateOptionValue(shopId, id, input)`, `deleteOptionValue(shopId, id)`, `archiveOptionValue(shopId, id)`, `reorderOptionValues(shopId, ids, optionGroupId?)`
- Add-Ons: `listAddOns(shopId, options?)`, `getAddOn(shopId, id)`, `createAddOn(shopId, input)`, `updateAddOn(shopId, id, input)`, `deleteAddOn(shopId, id)`, `archiveAddOn(shopId, id)`, `reorderAddOns(shopId, ids)`
- Sync: `markSynced(shopId, entity, id, variantId, productId?)`
- Storefront: `getStorefrontCatalog(shopId)` returning spec 03 `CatalogResponse`
Exports error class `ValidationError` (extends `BadRequestError`), and DTO types `CatalogLensDto`, `CatalogLensGroupDto`, `CatalogOptionGroupDto`, `CatalogOptionValueDto`, `CatalogAddOnDto`.
Enforces limits constraints (`sphMin <= sphMax`, `cylMin <= cylMax`, `addMin <= addMax` with `LIMITS_INVERTED`), price non-negativity (`NEGATIVE_PRICE`), unique names within groups/shops (`NAME_NOT_UNIQUE`), code exclusivity for option values (`ONE_CODE_SOURCE`), and throws `NotFoundError` on cross-shop or missing IDs.
**Use instead of:** business logic inside admin route loaders/actions or raw Prisma rows past the service boundary.
**Added by:** spec 14.

### `compliance-jobs`
`app/features/compliance/jobs.server.ts` — `compliance.customers-redact`, `compliance.customers-data-request`, and `compliance.shop-redact`. Payloads are ids only. Discovered from this file by the worker.
**Use instead of:** Inline webhook work, or a job payload that carries prescription values or a mailbox.
**Added by:** spec 25.

### `compliance-redact`
`app/features/compliance/redact.server.ts` — `runCustomersRedact` deletes the listed orders' prescriptions and `rx/<id>/` objects and nulls `LabOrder.prescriptionId`. `runShopRedact` deletes every shop-owned row in one transaction, then `deletePrefix("shops/<shopId>/")`.
**Use instead of:** Direct S3 calls, or a delete that is not scoped by `shopId`.
**Added by:** spec 25.

### `compliance-webhook-route`
`app/routes/webhooks.compliance.ts` — One action for `customers/data_request`, `customers/redact`, and `shop/redact`. Verifies the webhook, records a `ComplianceRequest`, enqueues the matching job, and returns 200. A forged HMAC is 401. An unknown shop is 200 with no row.
**Use instead of:** A route per compliance topic, or doing redaction, mail, or S3 work inside the request.
**Added by:** spec 25.

### `configurator-focus-trap`
`packages/configurator/src/shell/trap.ts` — `createFocusTrap({ container, trigger, onEscape })`. Locks body scroll (`overflow: hidden`) on activate, loops Tab and Shift+Tab navigation within focusable elements, triggers `onEscape` on Escape key, and releases scroll lock and returns focus to `trigger` on deactivate or disconnect.
**Use instead of:** Third-party focus trap libraries or un-trapped modals.
**Added by:** spec 16.

### `dispatch-handler`
`app/features/lab-dispatch/jobs.server.ts` — `dispatchJob`:
- Registers the worker handler for `lab-orders.dispatch` with pg-boss (`retryLimit: 5`, `retryDelay: 2`, `retryBackoff: true`).
- Validates job payload `{ labOrderId: string }` via `dispatchJobPayloadSchema` (INV-2, R1-F4).
- Resolves owning shop by id through repository function `getLabOrderShopId`, then scopes all subsequent reads and writes strictly by that shopId (INV-1, R1-F4).
- Invokes `processDispatch` to execute the ticket generation, S3 storage, and Resend email pipeline; completes without burning retries if meeting a fresh SENDING lease (R3-F1).
**Use instead of:** Unregistered or stubbed dispatch background jobs.
**Added by:** spec 30.

### `dispatch-service`
`app/features/lab-dispatch/dispatch.service.server.ts` — `processDispatch` and `resend`:
- `processDispatch(shopId, labOrderId, deps)`: Orchestrates the dispatch lifecycle:
  1. Transitions order status to SENDING via atomic conditional update; reclaims stale SENDING rows older than 15 min reusing existing attempts (R1-F2, R1-F9). If meeting a fresh SENDING lease, enqueues delayed dispatch with startAfter = lease expiry + DELAY_MARGIN_MS (5s) (R3-F1).
  2. Wraps the entire body after transition so any throw calls `markFailed` before rethrowing; rows never stick in SENDING (R1-F2). If markFailed returns null (lost lease / slow worker), logs and returns SKIPPED (R3-F4).
  3. Resolves lab emails from `getSettings` (Spec 15); fails permanently with `NO_LAB_EMAIL` if missing (no retry).
  4. Loads and decrypts ticket data (`loadTicketData`); fails with `RX_DECRYPT_FAILED` on tamper/schema errors (retried), or `LOAD_FAILED` on missing rows (R1-F7).
  5. Renders ticket per `ticketFormat` (`PDF`, `CSV`, or `BOTH`); fails with `TICKET_RENDER_FAILED` on renderer errors (R1-F7) and stores in S3 under `shops/<shopId>/tickets/<labOrderId>.<ext>` using `putObject` (Spec 06).
  6. Downloads uploaded prescription files from S3 via presigned URLs bounded by timeout (15s) and size cap (10MB) (R1-F12).
  7. Sends email to lab addresses via `Mailer.send` with `idempotencyKey = labOrderId + ':' + attempts` (Spec 07); fails with `MAIL_FAILED` on provider error (retried).
  8. Updates order status to `SENT` with `providerId`, `ticketKeys`, and `sentAt`. If markSent throws after send, enqueues delayed dispatch for lease expiry + margin so retry reclaims after lease with same idempotency key (R3-F1). If markSent returns null (lost lease / slow worker), logs and returns SKIPPED, never SENT (R3-F4).
- `resend(shopId, labOrderId, deps)`: Validates order tenancy (INV-1), conditionally resets order status to `PENDING` (clearing `lastErrorCode`), and re-enqueues `lab-orders.dispatch`. Refuses `PENDING` or `SENDING` with `ConflictError` (R1-F5). Used by Spec 32 admin interface.
**Use instead of:** Inline dispatch workflows in webhook routes or admin UI loaders.
**Added by:** spec 30.

### `field-cipher`
`app/shared/crypto/field-cipher.server.ts` — Factory `createFieldCipher({ keys, activeKeyId })` producing a `FieldCipher` that encrypts JSON with AES-256-GCM (random 12-byte IV, 16-byte auth tag, caller AAD) into one base64url token carrying the version and key id. Decrypt selects the key by id (`UnknownKeyError`) and returns parsed JSON only after the auth tag matches (`DecryptError` otherwise).
**Use instead of:** Calling `node:crypto` from feature code, inventing a token format, or storing prescription JSON in plaintext.
**Added by:** spec 05.

### `jobs-discovery-contract`
`app/shared/queue/discovery.server.ts` & `app/shared/queue/web-definitions.server.ts` — Feature job discovery contract. Features export `JobDefinition` instances from `app/features/<feature>/jobs.server.ts`. Discovered via eager glob on the web side (`registerWebFeatureJobs`) and filesystem directory scan on the worker side (`discoverJobs`).
**Use instead of:** Manually registering feature job handlers in a central worker file.
**Added by:** spec 08.

### `key-builders`
`app/shared/storage/object-store.server.ts` — Standardized S3 object key and prefix builders (`buildRxKey`, `buildTicketKey`, `buildShopPrefix`, `buildRxPrefix`, `buildTicketPrefix`) enforcing canonical storage layout (`shops/<shopId>/rx/<prescriptionId>/<uuid>.<ext>` and `shops/<shopId>/tickets/<labOrderId>.<pdf|csv>`) and path-traversal rejection (`/`, `..`, null bytes).
**Use instead of:** String-concatenating manual S3 keys or inventing non-standard storage paths.
**Added by:** spec 06.

### `lab-dispatch-repository`
`app/features/lab-dispatch/lab-dispatch.repository.server.ts` — Tenancy-scoped database access functions for lab order dispatch:
- `transitionToSending(shopId, labOrderId, db)`: Executes atomic conditional `UPDATE ... RETURNING attempts` statement via `$queryRaw` from `PENDING` or `FAILED` (incrementing attempts) or reclaims stale `SENDING` lease older than 15 min (reusing attempts) (Self-check 1, R1-F2, R1-F9).
- `getLabOrderShopId(labOrderId, db)`: Documented as the only id-to-shop resolver for internal job queue payloads (R1-F4).
- `markSent(shopId, labOrderId, data, db)`: Updates order status to `SENT` conditional on `status = 'SENDING'` (R1-F5).
- `markFailed(shopId, labOrderId, errorCode, db)`: Updates order status to `FAILED` conditional on `status = 'SENDING'` (R1-F5).
- `resetLabOrderStatus(shopId, labOrderId, status, db)`: Conditionally resets status (`status IN ('FAILED', 'SENT')`); refuses `PENDING`/`SENDING` with `ConflictError` (R1-F5).
- `getLabOrder(shopId, labOrderId, db)`: Fetches a lab order scoped to `shopId` (INV-1).
- `getPrescription(shopId, prescriptionId, db)`: Fetches prescription row scoped to `shopId` (INV-1).
- `getLens(shopId, lensId, db)`: Fetches lens row (including archived) scoped to `shopId` (INV-1).
- `getOptionValues(shopId, optionValueIds, db)`: Fetches option values scoped to `shopId` (INV-1).
- `getAddOns(shopId, addOnIds, db)`: Fetches add-ons scoped to `shopId` (INV-1).
**Use instead of:** Mutating `app/features/lab-orders/lab-orders.repository.server.ts` or unscoped DB queries.
**Added by:** spec 30.

### `lab-orders-admin-repository`
`app/features/lab-orders-admin/lab-orders-admin.repository.server.ts` — Database access scoped strictly by `shopId` (INV-1):
- `listLabOrders(shopId, options, db)`: Queries `LabOrder` with `where: { shopId, ...status }`, `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`, and cursor pagination with shop validation (INV-1, R1-F7).
- `getLabOrderDetail(shopId, labOrderId, db)`: Fetches `LabOrder` with `where: { id: labOrderId, shopId }`, selecting safe prescription fields (`id`, `rxType`, `source`, `uploadKeys`, `createdAt`), lens, option values, and add-ons.
**Use instead of:** Unscoped Prisma queries across merchants.
**Added by:** spec 32.

### `lab-orders-admin-routes`
- `app/routes/app.lab-orders._index.tsx`: List route with status filtering, cursor pagination, shopify order link, frame, lens, status badge with error code translation and settings link, out-of-limits badge, and empty state.
- `app/routes/app.lab-orders.$id.tsx`: Detail route with order metadata, prescription summary (INV-2), per-click ticket download action (Self-check 1), and "Resend to lab" `<s-modal>` confirmation (Spec 30 reuse).
**Use instead of:** Creating duplicate admin order screens.
**Added by:** spec 32.

### `lab-orders-admin-service`
`app/features/lab-orders-admin/lab-orders-admin.service.server.ts` — Read and dispatch services for merchant lab order management:
- `listLabOrdersService(shopId, options, deps)`: Reads newest-first lab orders scoped to `shopId` with cursor pagination (default 50 per page) and optional status filtering (INV-1).
- `getLabOrderDetailService(shopId, labOrderId, deps)`: Reads order detail scoped to `shopId`, joining lens, prescription metadata (never plaintext/cipher Rx, INV-2), option values with option group kind/name, and add-ons. Returns null if not found or belongs to another shop.
- `resendLabOrderService(shopId, labOrderId, deps)`: Resets order status to `PENDING`, clears `lastErrorCode`, and re-enqueues `lab-orders.dispatch` by delegating to Spec 30's `resend` (INV-1).
- `getTicketDownloadUrlService(shopId, labOrderId, ticketKey, deps)`: Validates that `ticketKey` starts with `shops/<shopId>/tickets/<labOrderId>.`, ends with an allowed extension (`.pdf` or `.csv`), and belongs to `order.ticketKeys` (INV-1, R1-F4). Generates a presigned 60-second S3 download URL using `getObjectStore().presignDownload` (Spec 06, Self-check 1).
- `formatPrescriptionSummary(prescription)`: Formats prescription metadata into privacy-safe copy ("Prescription: on file (typed)", "Prescription: on file (uploaded, N file(s))", "None", or "Non-prescription") without leaking clinical diopters or notes (INV-2).
**Use instead of:** Ad-hoc order queries or generating download URLs inside loaders.
**Added by:** spec 32.

### `lab-orders-intake-service`
`app/features/lab-orders/intake.service.server.ts` — Domain service (`IntakeService`, `createIntakeService`) orchestrating order intake:
- `processOrderIntake(shopDomain, shopifyOrderId)`: Resolves shop tenancy strictly by domain (INV-1, R2-F9), queries order via Admin GraphQL (`ORDER_INTAKE_QUERY`, conforming to Shopify 2026-10 schema, R1-F1, R2-F4) with cursor pagination across all line item pages (R1-F5; throws if order is null on page two or later to retry, R2-F10), groups line items by `_bundle_id`, parses lens bundle properties and identifies frame line using `readBundleProperties` (spec 03), validates lens shop tenancy and options/add-ons tenancy within `shop.id` (INV-1, R2-F1), checks prescription existence and tenant isolation (`getPrescriptionById`), links prescription to order (`attachOrder`), decrypts manual Rx in local memory to evaluate `checkLens` (spec 11) without storing decrypted Rx on `LabOrder` (INV-2, Self-check 3), upserts `LabOrder` rows, and enqueues `lab-orders.dispatch` jobs with `{ labOrderId }` and `singletonKey = labOrderId` only if the row is in `PENDING` status (R1-F3).
- Bundles missing lens line (`NO_LENS_IN_BUNDLE`) or `_item_id` (`LENS_NOT_FOUND`) create a `LabOrder` with `status = FAILED`, `lensId = null`, and no dispatch (R2-F2).
- Unknown or cross-shop lens creates a `LabOrder` with `lensId = null`, `status = FAILED`, `lastErrorCode = LENS_NOT_FOUND`, and triggers no dispatch (INV-1, R2-F1).
- Unknown or cross-shop options or add-ons create a `LabOrder` with `status = FAILED`, `lastErrorCode = OPTION_NOT_FOUND`, and trigger no dispatch (INV-1, R2-F1).
- Orders with unknown or cross-shop `_rx_ref` create a `LabOrder` with `prescriptionId = null`, `status = FAILED`, `lastErrorCode = RX_NOT_FOUND`, and trigger no dispatch.
- Orders without bundle lines create no rows and complete immediately (Row 6).
- Helpers: `extractAttributesRecord`, `ORDER_INTAKE_QUERY`. Re-exports `toOrderGid`, `fromOrderGid`.
**Use instead of:** Ad-hoc order parsing or mixing GraphQL fetches and limits checking in route actions or queue workers.
**Added by:** spec 23.

### `lab-orders-jobs`
`app/features/lab-orders/jobs.server.ts` — Background job definitions conforming to spec 08 queue contract:
- `INTAKE_JOB_NAME = "lab-orders.intake"` (`intakeJob`): Payload `{ shopDomain: string, shopifyOrderId: string }` validated by `intakeJobPayloadSchema` (numeric order ID required, R2-F8; `allowStringFields: ["shopDomain"]`, R2-F9). Handler throws on `ok: false` (`SHOP_NOT_FOUND`, `ORDER_NOT_FOUND`) so pg-boss retries (R2-F2).
- `DISPATCH_JOB_NAME = "lab-orders.dispatch"` (`dispatchJob`): Payload `{ labOrderId: string }` validated by `dispatchJobPayloadSchema`. Producer-only definition without production worker handler (R1-F2); executable worker handler registered by spec 30.
- Payload schemas strictly satisfy INV-2.
**Use instead of:** Raw `pg-boss` queues or unvalidated job payloads.
**Added by:** spec 23.

### `lab-orders-repository`
`app/features/lab-orders/lab-orders.repository.server.ts` — Shop-scoped Prisma data access functions for the `LabOrder` model:
- `upsertLabOrder(db, shopId, input)`: Upserts a `LabOrder` using a single atomic statement on the unique key `@@unique([shopId, shopifyOrderId, bundleId])` (INV-1, Self-check 2). Supports nullable `lensId` when a lens is not found or deleted (R2-F1). On conflict, terminal and workflow-owned fields (`status`, `lastErrorCode`, `attempts`, `ticketKeys`, `providerId`, `sentAt`) are preserved (R1-F3). Concurrent duplicate calls cannot produce duplicate rows.
- `getLabOrderById(db, shopId, id)`: Fetches a lab order by ID scoped strictly to `shopId` (INV-1).
- `getLabOrderByShopifyOrderAndBundle(db, shopId, shopifyOrderId, bundleId)`: Look up lab order by Shopify order ID and bundle ID scoped to `shopId` (INV-1).
- `listLabOrdersByShop(db, shopId)`: Lists all lab orders for a given shop scoped to `shopId` (INV-1).
**Use instead of:** Raw Prisma queries on `LabOrder` or unscoped order mutations.
**Added by:** spec 23.

### `mailer`
`app/shared/mail/mailer.server.ts` — Factory `createResendMailer({ client, from, logger })` producing a `Mailer` adapter that sends emails with attachments up to 10 MB, passes idempotency keys to Resend, maps provider responses to `MailRejectedError` (4xx) and `MailTransientError` (429/5xx/network), and logs only provider id, recipient domain, and subject length (INV-2).
**Use instead of:** Instantiating Resend clients directly in feature code or sending emails without idempotency and error mapping.
**Added by:** spec 07.

### `mailer-container`
`app/shared/container/mailer.server.ts` — Composition root lazy singleton getter `getMailer()` providing the shared `Mailer` instance configured from `config.server.ts` (`RESEND_API_KEY`, `MAIL_FROM`).
**Use instead of:** Reading Resend environment variables or constructing `Resend` in route loaders, actions, or background workers.
**Added by:** spec 07.

### `object-store`
`app/shared/storage/object-store.server.ts` — Factory `createObjectStore({ client, bucket, kmsKeyId })` producing an `ObjectStore` adapter that enforces server-side encryption (SSE-KMS) on all uploads, short-lived presigned download URLs, head-object queries, and safe shop-scoped paginated prefix deletions.
**Use instead of:** Instantiating AWS S3 clients directly in feature code or issuing presigned URLs without KMS encryption.
**Added by:** spec 06.

### `object-store-container`
`app/shared/container/object-store.server.ts` — Composition root lazy singleton getter `getObjectStore()` providing the shared S3 `ObjectStore` instance configured from `config.server.ts`.
**Use instead of:** Reading S3 environment variables or constructing `S3Client` in route loaders, actions, or background workers.
**Added by:** spec 06.

### `prescriptions-repository`
`app/features/prescriptions/prescriptions.repository.server.ts` — Shop-scoped Prisma data access functions (`createPrescription`, `getPrescriptionById`, `attachOrder`, `updatePrescriptionUpload`, `findShopByDomain`) guaranteeing multi-tenant shop isolation (INV-1). Queries filter by `(shopId, id)` unique constraint and return plain DTOs.
**Use instead of:** Raw Prisma queries on the `Prescription` model or cross-shop reads/writes.
**Added by:** spec 22.

### `prescriptions-service`
`app/features/prescriptions/prescriptions.service.server.ts` — Domain service (`createPrescriptionsService`, `PrescriptionsService`) encapsulating prescription submission business rules, verified-domain shop resolution (`resolveShopByDomain`, `requestUploadUrlByDomain`, `submitPrescriptionByDomain`, R4-F2), spec 10 re-validation, AAD binding before encryption, S3 key prefix validation, mutual exclusion enforcement (R4-F1), and storage integrity checks. Accepts plain values in/out with zero HTTP or `react-router` dependencies.
**Use instead of:** Placing prescription business logic, validation, or cipher calls inside route actions or loaders.
**Added by:** spec 22.

### `pricing-plans-url`
`app/features/billing/plan.server.ts` — `buildPricingPlansUrl(shopDomain, appHandle)` builds `https://admin.shopify.com/store/<store>/charges/<app-handle>/pricing_plans`; the store handle is derived from the authenticated session's shop domain.
**Use instead of:** hardcoding a plan-selection URL in a route.
**Added by:** spec 09.

### `prisma-container`
`app/shared/container/prisma.server.ts` — Composition root lazy singleton getter `getPrisma()` for the PrismaClient instance.
**Use instead of:** Instantiating `new PrismaClient()` in feature code or routes.
**Added by:** spec 01.

### `proxy-prescriptions-endpoint`
`app/routes/proxy.prescriptions.ts` — Storefront app proxy endpoint `POST /apps/lens-advisor/prescriptions`. Authenticates proxy signature (`authenticate.public.appProxy`, INV-6), rate limits (20 req/min/shop+IP), validates payload via `parsePrescriptionSubmitBody` enforcing mutual exclusion between manual and upload modes (R4-F1). Re-validates clinical rules via spec 10 (`validatePrescription`); for `MANUAL` encrypts Rx payload into AES-256-GCM token using AAD `shopId:prescriptionId` (spec 05, INV-2); for `UPLOAD` validates that each key is under `shops/<shopId>/rx/<draftId>/`, exists in S3 via `headObject`, satisfies size limits (1 byte to 10 MB inclusive) and allowed content types, and caps upload keys to at most 5 keys (`MAX_UPLOAD_KEYS = 5`). Delegates domain lookup and submission to `PrescriptionsService.submitPrescriptionByDomain` (R4-F2). Returns `{ rxRef }` (HTTP 201).
- **Uploaded keys limit:** 1 to 5 keys inclusive (`MAX_UPLOAD_KEYS = 5`; > 5 rejected).
- **S3 file size limit:** 1 byte to 10 MB inclusive (1 to 10,485,760 bytes; 0 and > 10 MB rejected).
- **Allowed content types:** `image/jpeg`, `image/png`, `image/heic`, `application/pdf`.
- **Rate limit:** 20 requests per minute per verified shop domain + client IP.
- **Mutual exclusion:** Ambiguous requests combining manual and upload fields return 400 `AMBIGUOUS_RX_SOURCE` without modifying draft state (R4-F1).
- **Architecture:** Route authenticates, rate-limits, parses body, and calls one service function with zero repository imports (R4-F2).
**Use instead of:** Storing unvalidated or plaintext prescription data in Shopify cart properties or custom tables.
**Added by:** spec 22.

### `require-active-plan`
`app/features/billing/require-plan.server.ts` — `requireActivePlan(request)` authenticates the admin request, returns the normal admin context with `plan` attached, and throws a top-frame redirect to Shopify's hosted plan-selection page when the shop has no active plan. Lookup failures propagate as `AppError 502` and never redirect.
**Use instead of:** calling `authenticate.admin` and checking the plan separately in each admin loader.
**Added by:** spec 09.

### `shop-settings-repository`
`app/features/settings/settings.repository.server.ts` — `findShopSettings(db, shopId)`, `lockShop(db, shopId)`, `upsertShopSettings(db, shopId, settings)`. Each call filters by `shopId`. `lockShop` is a `SELECT … FOR UPDATE` on that shop row. `upsertShopSettings` writes only the row passed in; a throw inside the same transaction rolls the write back.
**Use instead of:** a Prisma call in a route or a settings query without `shopId`.
**Added by:** spec 15.

### `sync-error`
`app/features/product-sync/errors.ts` (re-exported from `app/features/product-sync/index.ts`) — `SyncError` extends `AppError` (HTTP status 400). Error codes: `SYNC_FAILED`, `CURRENCY_MISMATCH`, `GRAPHQL_ERROR`, `ORPHAN_PRODUCT`.
**Use instead of:** generic Error or unhandled exceptions when communicating with Shopify GraphQL APIs.
**Added by:** spec 17.

### `sync-item`
`app/features/product-sync/product-sync.server.ts` (re-exported from `app/features/product-sync/index.ts`) — `syncItem(admin, shopId, entity, id, deps?)` synchronizes a purchasable catalog item (`"lens"`, `"optionValue"`, or `"addOn"`) to Shopify.
- Validates shop tenancy (INV-1) by querying the entity through `catalogService` scoped to `shopId`.
- Validates shop currency against item currency (`CURRENCY_MISMATCH`).
- Converts minor units to a decimal string via `toShopifyDecimal` (INV-4).
- For unpriced option values (delta 0), skips sync without creating a Shopify product (`{ ok: true, skipped: true }`).
- Idempotent on retry: looks up stored IDs first; if `shopifyVariantId` already exists, converges to the same end state as a fresh sync by updating product title, vendor (`"Lens Advisor"`), tags (`["lens-advisor-item"]`), status `ACTIVE`, and metafields (`seo.hidden = 1`, type `number_integer`) via `productUpdate` (sharing `buildProductInput`), updating variant price via `productVariantsBulkUpdate` (with `inventoryItem: { tracked: false }`), and publishing to the Online Store channel, never recreating the product.
- For new items, creates a Shopify product with title (`"Lens: <name>"`, `"Option: <label>"`, or `"Add-on: <name>"`), vendor `"Lens Advisor"`, tag `lens-advisor-item`, status `ACTIVE`, and metafield `seo.hidden = 1` (type `number_integer`) to exclude it from storefront search and sitemaps. Persists IDs to Postgres immediately via `markSynced` (compensating with `productDelete` if persisting fails; if deletion is not confirmed via matching `deletedProductId`, throws `SyncError` with code `ORPHAN_PRODUCT` and logs the product GID and catalog id). Then updates variant price and publishes to the Online Store channel (`publishablePublish`, with paginated publication resolution).
- Partial-progress behavior on failure: IDs are persisted right after `productCreate` succeeds. Failures before ID persistence (such as currency mismatch, publication resolution, or `productCreate` user errors) leave the catalog DB row unchanged. Failures occurring after IDs are persisted (during variant price update or publication) throw `SyncError` while leaving IDs set in the catalog DB row; a subsequent retry resumes from the stored IDs (updating product details, variant price, and publishing) rather than recreating the product.
**Use instead of:** direct Shopify GraphQL mutations or ad-hoc product creation in admin route actions.
**Added by:** spec 17.


## Domain logic (packages/rx-core)

### `bundle-line-properties`
`packages/rx-core/src/cart/bundle-properties.ts` — `buildBundleLineProperties` / `readBundleProperties` / `parsedToBuildInput` for nested cart line keys (`_bundle_id`, `_bundle_role`, `_item_id`, `_option_ids`, `_addon_ids`, `_rx_ref`, `_rx_od`/`_rx_os`/`_rx_pd`, visible `Prescription`). Id lists are JSON arrays. Constants `BUNDLE_ROLES`, `BUNDLE_PROPERTY_KEYS`, `PRESCRIPTION_ON_FILE`. Types `BundleRole`, `BuildBundleLinePropertiesInput`, `FormattedRxProperties`, `ParsedBundleLineProperties`.
**Use instead of:** hand-written `_bundle_*` keys in the configurator or the orders webhook.
**Added by:** spec 03.

### `check-lens`
`packages/rx-core/src/limits/check-lens.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `checkLens(rx, rxType, lens)` evaluates whether a lens can accommodate a given prescription and RxType. Transposes plus-cylinder eyes into minus-cylinder form before limits checks. Checks in fixed order: `rxType`, `OD SPH`, `OD CYL`, `OD ADD`, `OS SPH`, `OS CYL`, `OS ADD`. Returns `{ available: true }` or `{ available: false, reason }` where `reason` is `{ code, field, eye, value, limit }` with codes `RX_TYPE_NOT_SUPPORTED`, `SPH_BELOW_MIN`, `SPH_ABOVE_MAX`, `CYL_OUT_OF_RANGE`, `ADD_OUT_OF_RANGE`. Missing ADD limits mean no ADD restriction; non-prescription bypasses prescription checks.
**Use instead of:** ad-hoc SPH/CYL/ADD range comparisons in storefront or server code.
**Added by:** spec 11.

### `compile-lab-code`
`packages/rx-core/src/lab-code/compiler.ts` (re-exported from `packages/rx-core`) — `compileLabCode(lensOrTemplate, selections?)` compiles the optical lab code for an order line from a base lens template string (or `Lens` object) and chosen customer upgrades/options. Replaces bracketed tokens `[key=DEFAULT]` with selected values or defaults, and applies whole dash-separated segment overrides (e.g. `material` for the first segment). Overrides take precedence over tokens targeting the same segment. Token and override values are inserted as literal strings without regex interpretation (`$&`, `$1`, `.`). Unknown token keys in selections are reported in the `warnings` array (`UNKNOWN_TOKEN <key>`). Templates with no tokens compile to themselves for any selections. Returns `CompileLabCodeResult` (`{ code: string, warnings: string[] }`).
**Use instead of:** manual string replacement or ad-hoc lab code formatting.
**Added by:** spec 12.

### `filter-lenses`
`packages/rx-core/src/limits/filter-lenses.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `filterLenses(rx, rxType, lenses)` maps an array of lenses against a prescription and RxType, preserving input catalog order deterministically. Each returned item provides `{ lens, result, available, reason? }`.
**Use instead of:** manual looping and filtering of lenses against limits in step 4 or order intake.
**Added by:** spec 11.

### `format-axis`
`packages/rx-core/src/format/axis.ts` — `formatAxis(axisDegrees)` → three-digit optical string (`090`).
**Use instead of:** unpadded axis text.
**Added by:** spec 03.

### `format-diopter`
`packages/rx-core/src/format/diopter.ts` — `formatDiopter(hundredths)` → signed two-decimal string, `PL` for zero.
**Use instead of:** `toFixed`, string concat, or a second diopter formatter.
**Added by:** spec 03.

### `format-eye`
`packages/rx-core/src/format/eye.ts` — `formatEye(eye)` compact one-eye Rx (`-2.25/-0.50x180`).
**Use instead of:** hand-building `_rx_od` / `_rx_os` strings.
**Added by:** spec 03.

### `format-pd`
`packages/rx-core/src/format/pd.ts` — `formatPd(pd)` from integer tenths; dual PD as `od/os`.
**Use instead of:** dividing by 10 in UI or ticket code.
**Added by:** spec 03.

### `parse-axis`
`packages/rx-core/src/rx/parse.ts` — `parseAxis(text)` parses user input into integer degrees 1–180 (`Axis`). Rejects non-integers, out-of-range values, and hostile text with `AXIS_RANGE` or `INVALID`. Returns `ParseResult<Axis>`.
**Use instead of:** unvalidated `parseInt` or manual axis range checks.
**Added by:** spec 10.

### `parse-diopter-text`
`packages/rx-core/src/rx/parse.ts` — `parseDiopterText(text, options?)` (alias `parseDiopter`) parses shopper input text into signed integer hundredths of a diopter (`Diopter`). Normalizes Unicode minus (−, U+2212 and variants), comma decimals (,), plano representations (`PL`, `plano`, `0`, `0.00`), and negative zero (`"-0"`, `"-0.00"` → `0`). Quarter-step validation (0.25 D = 25 hundredths) and field range checks are performed via string splitting and integer arithmetic without float drift. Returns `ParseResult<Diopter>` (`{ ok: true, value } | { ok: false, error }`). Also exports convenience helpers `parseSphText`, `parseCylText`, and `parseAddText`.
**Use instead of:** `parseFloat`, `Number(...)`, or ad-hoc diopter regex parsing.
**Added by:** spec 10.

### `parse-money-text`
`packages/rx-core/src/pricing/money-text.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `parseMoneyText(text, currency)` returns `{ ok: true, amountMinor }` or `{ ok: false, error: "MONEY_FORMAT" | "MONEY_PRECISION" }`. Minor-unit scale comes from `Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits` (USD 2, JPY 0, KWD 3). Digits are walked as integers; extra fractional digits are `MONEY_PRECISION` and are not rounded. A comma, exponent, hex prefix, unknown currency, or unsafe integer is `MONEY_FORMAT`. A leading `+` or `-` (including U+2212) is accepted; `-0` becomes `0`.
**Use instead of:** `parseFloat`, `Number(text) * 100`, or a second money parser in the admin forms.
**Added by:** spec 13.

### `parse-pd`
`packages/rx-core/src/rx/parse.ts` — `parsePd(text, options?)` and `parseDualPd(odText, osText)` parse single or dual pupillary distance text into integer tenths of a millimetre (`PdTenthsMm`). Enforces 0.5 mm steps (5 tenths) and inclusive ranges (single: 50.0–80.0 mm / 500–800 tenths; dual: 25.0–40.0 mm / 250–400 tenths). Returns `ParseResult<PdTenthsMm>` or `ParseResult<{ od, os }>`.
**Use instead of:** float-based PD parsing or manual step/range calculations.
**Added by:** spec 10.

### `price-selection`
`packages/rx-core/src/pricing/price-selection.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `priceSelection(selection, catalog, framePrice)` returns `{ lines, total }`. Each line is `{ role, label, amount }` with `role` `frame` | `lens` | `option` | `addon` and `amount` a `Money`. Order is catalog array order: frame, lens (only when `lensId` is set), option values walked `optionGroups` → `values`, add-ons walked `addOns`. Selection id order does not change the lines. A repeated id is one line. The first catalog row wins when an id is duplicated. The frame line label is `"Frame"` (the frame title is not an input). Throws `PricingError`: `UNKNOWN_ITEM` (message `UNKNOWN_ITEM <id>`, `itemId` set; first unknown wins: lens, then option ids as listed, then add-on ids as listed), `CURRENCY_MISMATCH` (selected row currency ≠ frame currency; checked before the sign), `NEGATIVE_DELTA` (selected option delta < 0). A zero delta is a line with amount 0. `rxType` is not consulted.
**Use instead of:** summing prices in the configurator, the review step, or the admin preview.
**Added by:** spec 13.

### `pricing-error`
`packages/rx-core/src/pricing/errors.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `PRICING_ERROR_CODES` and `PricingError` (`code`, optional `itemId`). Codes: `CURRENCY_MISMATCH`, `NEGATIVE_DELTA`, `UNKNOWN_ITEM`, `MONEY_FORMAT`, `MONEY_PRECISION`.
**Use instead of:** ad-hoc price error strings.
**Added by:** spec 13.

### `rx-core-root-exports`
`packages/rx-core/src/index.ts` — the package's only barrel. Every public root export:

Values: `BUNDLE_PROPERTY_KEYS`, `BUNDLE_ROLES`, `PRESCRIPTION_ON_FILE`, `buildBundleLineProperties`, `parsedToBuildInput`, `readBundleProperties`, `formatAxis`, `formatDiopter`, `formatEye`, `formatPd`, `addOnSchema`, `axisSchema`, `catalogResponseSchema`, `catalogSettingsSchema`, `diopterSchema`, `eyeSchema`, `idSchema`, `iso4217CurrencySchema`, `lensGroupSchema`, `lensSchema`, `moneySchema`, `optionGroupKindSchema`, `optionGroupSchema`, `optionValueSchema`, `pdSchema`, `pdTenthsMmSchema`, `prescriptionSchema`, `prescriptionSubmitBodySchema`, `rxLimitsSchema`, `rxTypeSchema`, `selectionSchema`, `uploadUrlRequestSchema`, `OPTION_GROUP_KINDS`, `RX_TYPES`.

Types: `BundleRole`, `BuildBundleLinePropertiesInput`, `FormattedRxProperties`, `ParsedBundleLineProperties`, `AddOn`, `Axis`, `CatalogResponse`, `CatalogSettings`, `Diopter`, `Eye`, `Lens`, `LensGroup`, `Money`, `OptionGroup`, `OptionGroupKind`, `OptionValue`, `Pd`, `PdTenthsMm`, `Prescription`, `PrescriptionSubmitBody`, `RxLimits`, `RxType`, `Selection`, `UploadUrlRequest`.
**Use instead of:** importing from a file under `packages/rx-core/src/` other than this barrel, or redeclaring any of these names.
**Added by:** spec 03.

### `rx-validation-codes`
`packages/rx-core/src/rx/validate.ts` (also re-exported from `packages/rx-core/src/rx/parse.ts`) — `RX_VALIDATION_CODES` (alias `RX_ERROR_CODES`) closed enum of error codes: `SPH_RANGE`, `SPH_STEP`, `SPH_REQUIRED`, `CYL_RANGE`, `CYL_STEP`, `AXIS_REQUIRED`, `AXIS_RANGE`, `ADD_REQUIRED`, `ADD_RANGE`, `ADD_STEP`, `PD_REQUIRED`, `PD_RANGE`, `PD_STEP`, `NON_PRESCRIPTION_NOT_EMPTY`, `INVALID`. Types `RxValidationCode` and `RxErrorCode`.
**Use instead of:** raw string literals for prescription validation errors.
**Added by:** spec 10.

### `to-shopify-decimal`
`packages/rx-core/src/pricing/money-text.ts` (re-exported from `packages/rx-core/src/pricing/index.ts`) — `toShopifyDecimal(amountMinor, currency)` returns the Admin API decimal string (`8000` USD → `"80.00"`, `1500` JPY → `"1500"`, `1500` KWD → `"1.500"`). Integer split only. A non-integer amount or unknown currency throws `PricingError` `MONEY_FORMAT`.
**Use instead of:** `toFixed` or float division when setting a Shopify variant price.
**Added by:** spec 13.

### `transpose`
`packages/rx-core/src/limits/transpose.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — `transpose(eyeOrRx)` and `transposeEye(eye)` pure functions that perform optical cylinder transposition between plus and minus cylinder forms: `SPH' = SPH + CYL`, `CYL' = -CYL`, `AXIS' = AXIS <= 90 ? AXIS + 90 : AXIS - 90` (wrapping in 1–180, never 0 or 270). Plano CYL (0) or absent CYL is unchanged. Transposing twice returns the original input (involution).
**Use instead of:** ad-hoc manual cylinder transposition or axis conversions.
**Added by:** spec 11.

### `validate-prescription`
`packages/rx-core/src/rx/validate.ts` — `validatePrescription(rx, rxType)` checks a prescription against clinical rules and RxType constraints, returning an array of all `RxValidationError` items (`{ field, eye?, path?, code }`). Also exports `isValidPrescription(rx, rxType)`, `normalizePrescription(rx, rxType)` (which drops AXIS when CYL is 0 or absent and drops ADD for `SINGLE_VISION`), and `validateAndNormalizePrescription(rx, rxType)`.
**Use instead of:** custom prescription checks in routes or step components.
**Added by:** spec 10.

### `validate-template`
`packages/rx-core/src/lab-code/validator.ts` (re-exported from `packages/rx-core`) — `validateTemplate(text)` validates a lab code template string according to the grammar: literal text with tokens `[key=DEFAULT]` (key is `[a-z_]+`, default is `[A-Z0-9]*`). Used by admin forms (spec 18) for live preview and input validation. Checks for empty templates (`EMPTY_TEMPLATE`), unclosed brackets (`UNCLOSED_TOKEN`), unopened or malformed brackets (`MALFORMED_TOKEN`), and duplicate token keys (`DUPLICATE_TOKEN <key>`). Returns `TemplateValidationResult` (`{ valid: boolean, errors: TemplateValidationError[], error?: string, tokens: ParsedTemplateToken[] }`).
**Use instead of:** regex matching on template strings or saving unvalidated templates.
**Added by:** spec 12.


## Utils

### `admin-home-loader`
`app/features/home/home.server.ts` — `loadHomeData(request, deps?)` gates through `requireActivePlan(request)` (spec 09), inspects lens catalog state via `listLenses` (spec 14) and lab-email configuration via `isComplete` (spec 15), builds the product template theme-editor deep link with the app API key from config (spec 01), and returns `{ hasLens, hasLabEmail, apiKey, themeDeepLink }`.
**Use instead of:** direct database queries or ad-hoc checklist calculation in admin route loaders.
**Added by:** spec 31.

### `app-error`
`app/shared/http/errors.server.ts` — Base HTTP application error class (`AppError`) carrying HTTP status, upper-snake error code, safe message, and optional field error details.
**Use instead of:** Throwing bare `Response` objects or generic `Error` instances without standard codes.
**Added by:** spec 01.

### `archive-item`
`app/features/product-sync/product-sync.server.ts` (re-exported from `app/features/product-sync/index.ts`) — `archiveItem(admin, shopId, entity, id, deps?)` sets the corresponding Shopify product status to `DRAFT` when a catalog row is archived or disabled.
- Reads the entity via `catalogService` scoped to `shopId` (INV-1).
- Looks up the product ID from stored `shopifyProductId` or queries the parent product from `shopifyVariantId` (`GetVariantProduct`).
- If never synced, returns `{ ok: true, archived: false, reason: "NOT_SYNCED" }`.
- Executes `productUpdate` with status `DRAFT`, throwing `SyncError` on failure.
**Use instead of:** manual Shopify product drafting or deleting products on archive.
**Added by:** spec 17.

### `bundle-size-check`
`packages/configurator/scripts/check-bundle-size.mjs` — Runs at the end of `scripts/build.mjs`. Requires `assets/` to be exactly `configurator.js`, `loader.css`, and `loader.js`, with no subfolders, and `loader.js` ≤ 10 KB minified (not gzip).
**Use instead of:** A gzip budget, or a size check that lives only outside the package build.
**Added by:** spec 04.

### `compliance-data-request`
`app/features/compliance/data-request.server.ts` — `runCustomersDataRequest` decrypts that shop's prescriptions for the listed orders and emails one JSON attachment to the shop contact. The log line is ids only.
**Use instead of:** Emailing the customer directly, or logging the decrypted prescription.
**Added by:** spec 25.

### `config-getters`
`app/shared/config.server.ts` — Lazy, zod-validated environment configuration reader exposing typed config sections (`database`, `shopify`, `rx`, `s3`, `resend`, `appProxy`) and standalone getters.
**Use instead of:** Reading `process.env` anywhere in `app/` or `packages/`.
**Added by:** spec 01.

### `configurator-lens-format-reason`
`packages/configurator/src/steps/04-lens/format-reason.ts` — Formats structured `LimitExceededReason` objects from the limits engine (`SPH_BELOW_MIN`, `SPH_ABOVE_MAX`, `CYL_OUT_OF_RANGE`, `ADD_OUT_OF_RANGE`, `RX_TYPE_NOT_SUPPORTED`) into human-readable strings via `strings.ts` templates and `formatDiopter` (INV-5), normalizing hyphen to typographic minus (`\u2212`).
**Use instead of:** Re-implementing diopter formatting or writing unformatted diopter values.
**Added by:** spec 27.

### `configurator-loader`
`packages/configurator/src/entries/loader.ts` — Storefront loader. Exports `MOUNT_SELECTOR` (`[data-la-mount]`), `OPEN_SELECTOR` (`[data-la-open]`), `CONFIGURATOR_SCRIPT_SELECTOR`, `OPEN_EVENT` (`la:open`), `OpenDetail`, `injectConfigurator` (one `configurator.js` per document), `dispatchOpen`, `bindMount`, `bindAll`, `bootWhenReady`.
**Use instead of:** A second click-to-inject script, or a `<script>` tag for `configurator.js` in Liquid.
**Added by:** spec 04.

### `configurator-money-format`
`packages/configurator/src/shared/format.ts` — `formatMoney(amountMinor, currency, locale)`. Formats integer minor units via `Intl.NumberFormat`. Complies with INV-4: no float arithmetic on money.
**Use instead of:** `toFixed` or `parseFloat` on monetary values.
**Added by:** spec 16.

### `configurator-reducer`
`packages/configurator/src/shell/reducer.ts` — Pure state machine reducer `configuratorReducer(state, action, steps)` and initial state factory `createInitialState(frameVariantId)`. State shape: `{ stepIndex, rxType, prescription, prescriptionRef, catalog, selection, status, error, isOpen }`. Actions are a closed union: `OPEN`, `CLOSE`, `CATALOG_LOADING`, `CATALOG_LOADED`, `CATALOG_ERROR`, `SET_RX_TYPE`, `SET_PRESCRIPTION`, `SET_PRESCRIPTION_REF`, `SET_LENS`, `SET_OPTIONS`, `TOGGLE_OPTION`, `SET_ADDONS`, `TOGGLE_ADDON`, `CONTINUE`, `BACK`, `GO_TO_STEP`, `RESET`. Enforces gating: `CONTINUE` is impossible while the current step's `isComplete(state)` is false.
**Use instead of:** Mutating configurator state directly or performing side effects inside reducers.
**Added by:** spec 16.

### `error-responder`
`app/shared/http/errors.server.ts` — JSON error responder (`errorResponse` / `jsonError`) formatting errors into the standardized `{ "error": { "code": "...", "message": "..." } }` envelope.
**Use instead of:** Manually constructing ad-hoc JSON error responses in routes.
**Added by:** spec 01.

### `load-ticket-data`
`app/features/lab-dispatch/load-ticket-data.server.ts` — `loadTicketData(shopId, labOrderId, deps)`:
- Loads `LabOrder` and referenced catalog entities (`Lens`, `OptionValue`, `AddOn`), ensuring archived catalog rows remain readable for old orders (Self-check 3).
- Decrypts the prescription ciphertext using AES-256-GCM with context AAD `${shopId}:${prescriptionId}` (INV-2).
- Validates the decrypted payload with rx-core's `prescriptionSchema` (R1-F8); fails with data-free `RxDecryptError` (`RX_DECRYPT_FAILED`) if decryption or schema validation fails.
- Formats selections and options for lab-code compilation (Spec 12 / Spec 24).
- Returns structured `TicketData` for PDF and CSV renderers (Spec 24).
**Use instead of:** Ad-hoc order/lens/prescription joins and unverified ciphertext handling.
**Added by:** spec 30.

### `nav-glob-contract`
`app/shared/nav/index.ts` — Admin navigation discovery contract that eagerly globs `app/features/*/nav.ts` modules exporting `{ nav: { label, href, order } }` or default export, sorted ascending by `order`.
**Use instead of:** Hardcoding navigation items or adding links directly to `app/routes/app.tsx`.
**Added by:** spec 01.

### `prescription-rate-limiter`
`app/features/prescriptions/rate-limiter.server.ts` — In-memory rolling-window rate limiter (`MemoryRateLimiter`, singleton `prescriptionRateLimiter`) enforcing 20 requests per minute per shop+IP with 429 `RATE_LIMITED` responses.
**Use instead of:** Unbounded public app proxy endpoints.
**Added by:** spec 22.

### `render-csv`
`app/features/lab-orders/ticket/csv-renderer.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `renderCsv(TicketData): Buffer` produces an RFC 4180-compliant UTF-8 CSV buffer containing a standard header row and one row per eye (OD and OS). Includes order metadata, compiled lab code (spec 12), options, add-ons, source, `rx_out_of_limits` column, uploaded files, eye designation, and eye prescription columns (sph, cyl, axis, add, pd, notes). Implements formula injection prevention (values starting with `=`, `+`, `-`, `@` are prefixed with `'`, except numeric diopter columns which are safe).
**Use instead of:** ad-hoc CSV string joining or unquoted CSV formatting.
**Added by:** spec 24.

### `render-pdf`
`app/features/lab-orders/ticket/pdf-renderer.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `renderPdf(TicketData): Promise<Buffer>` produces a one-page A4 PDF lab job ticket in memory via pdfkit. Renders order information, frame title/SKU, lens name, compiled lab code (spec 12), compiler warnings (such as `UNKNOWN_TOKEN`) under the code, selected option labels and add-on names, prescription details formatted via rx-core formatters (OD, OS, PD, notes), an out-of-limits warning band when `rxOutOfLimits=true`, and "Prescription file attached" with attached file names when source is `UPLOAD`.
**Use instead of:** manual PDF construction or HTML-to-PDF rendering in workers.
**Added by:** spec 24.

### `shop-owned-delete-order`
`app/features/compliance/models.server.ts` — `shopOwnedModels` and `shopOwnedModelDeleteOrder` list every shop-owned Prisma model from the DMMF (Session excluded; it is keyed by domain) and order deletes so a referencing row goes first.
**Use instead of:** A hand-maintained table list for `shop/redact`.
**Added by:** spec 25.

### `worker-glob-contract`
`app/worker.server.ts` — Background worker job discovery contract that globs `app/features/*/jobs.server.ts` modules and registers each exported job definition with the pg-boss queue.
**Use instead of:** Manually wiring job handler imports in a central worker file.
**Added by:** spec 01.


## Constants

### `admin-options-nav`
`app/features/catalog-options/nav.ts` — Navigation descriptor exporting `{ label: "Options & add-ons", href: "/app/options", order: 20 }` discovered by the app navigation glob.
**Use instead of:** hardcoding option catalog links in the admin layout.
**Added by:** spec 19.

### `admin-settings-nav`
`app/features/settings/nav.ts` — Admin navigation item for Settings (`{ label: "Settings", href: "/app/settings", order: 90 }`). Discovered automatically by `app/shared/nav/index.ts`.
**Use instead of:** hardcoding settings link in navigation components.
**Added by:** spec 20.

### `catalog-nav`
`app/features/catalog/nav.ts` — Navigation registration for the catalog feature in the admin sidebar.
- Registers "Lenses" link at `/app/lenses` with order 10.
**Use instead of:** hardcoding catalog navigation links.
**Added by:** spec 18.

### `configurator-strings`
`packages/configurator/src/shared/strings.ts` — Storefront strings for header, progress, footer, loading, error, and empty views. Complies with INV-9: all user-visible text in the shell is referenced from this file.
**Use instead of:** Inline string literals in JSX.
**Added by:** spec 16.

### `configurator-tokens`
`packages/configurator/src/styles/tokens.css` — Every `--la-*` token from `specs/DESIGN-SYSTEM.md`, on `:host` and `.la-block`. Merchant overrides fall through `--la-merchant-accent`, `--la-merchant-font-family`, and `--la-merchant-radius`. The only file in the package with raw colour, size, or duration values.
**Use instead of:** Raw colours, pixel sizes, or durations in configurator CSS or components.
**Added by:** spec 04.

### `lab-orders-admin-nav`
`app/features/lab-orders-admin/nav.ts` — Navigation item for admin sidebar (`{ label: "Lab orders", href: "/app/lab-orders", order: 5 }`).
**Use instead of:** Hardcoding lab orders navigation links.
**Added by:** spec 32.

### `lab-orders-error-codes`
`app/features/lab-orders-admin/errors.ts` — `LAB_ORDER_ERROR_MESSAGES`, `formatLabOrderError`, `UNKNOWN_ERROR_MESSAGE`:
- Mapping table from machine error codes (`NO_LAB_EMAIL`, `MAIL_FAILED`, `STORAGE_FAILED`, `RX_DECRYPT_FAILED`, `LOAD_FAILED`, `TICKET_RENDER_FAILED`, `NO_LENS_IN_BUNDLE`, `LENS_NOT_FOUND`, `OPTION_NOT_FOUND`, `RX_NOT_FOUND`) to plain English sentences (R1-F5).
- Unknown error codes return `UNKNOWN_ERROR_MESSAGE` ("Something went wrong") (Self-check 2).
**Use instead of:** Displaying raw error constants or arbitrary exception strings to merchants.
**Added by:** spec 32.


## Types and schemas

### `axis-type`
`packages/rx-core/src/types/index.ts` — `Axis`: integer degrees 1–180.
**Use instead of:** a string or a 0–360 angle.
**Added by:** spec 03.

### `catalog-dto-types`
`packages/rx-core/src/types/index.ts` — storefront DTOs `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`, `CatalogSettings`, `CatalogResponse`, `Selection`.
**Use instead of:** Prisma rows past the catalog service, or a second `Lens` type.
**Added by:** spec 03.

### `catalog-response-schema`
`packages/rx-core/src/schemas/catalog.ts` (`catalogResponseSchema`, `CatalogResponse`) — Zod schema and TypeScript type representing the complete storefront catalog payload, comprising `lensGroups`, `optionGroups`, `addOns`, and shopper-safe `settings` (`manualRxEnabled`, `rxUploadEnabled`, `storeRxInOrder`). Extra settings (such as lab email addresses) are omitted by design to prevent data leakage (INV-3).
**Use instead of:** ad-hoc catalog response shapes.
**Added by:** spec 03, consumed by spec 21.

### `catalog-schemas`
`app/features/catalog/schema.ts` — Zod schemas for admin form inputs and updates: `lensGroupInputSchema`, `lensGroupUpdateSchema`, `lensInputSchema`, `lensUpdateSchema`, `optionGroupInputSchema`, `optionGroupUpdateSchema`, `optionValueInputSchema`, `optionValueUpdateSchema`, `addOnInputSchema`, `addOnUpdateSchema`, `reorderSchema`, helper `validateInput`, and error class `ValidationError`. Enforces integer money (INV-4) and integer hundredths for diopters (INV-5).
**Use instead of:** unvalidated forms or hand-rolled request validation for catalog entities.
**Added by:** spec 14.

### `configurator-api-client`
`packages/configurator/src/shared/api.ts` — Typed HTTP client for the app proxy. Methods: `getCatalog(productId)`, `submitPrescription(body)`, `getUploadUrl(file)`, `uploadFile(url, file)`. `getUploadUrl` accepts browser `File`/`Blob` instances (mapping `type` to `contentType` and `size`) and preserves the DTO overload (`UploadUrlRequest`). Parses responses with spec 03 schemas (`catalogResponseSchema`, etc.). Maps network, HTTP, and schema validation failures to `ApiError` with `{ code }` (e.g. `BAD_RESPONSE`, `NOT_AVAILABLE`, `RATE_LIMITED`, `NETWORK_ERROR`). Injected into steps via `ApiContext` and `useApi` hook (DI only).
**Use instead of:** Raw `fetch` calls or unvalidated response access.
**Added by:** spec 16.

### `configurator-element`
`packages/configurator/src/entries/configurator.ts` & `packages/configurator/src/shared/types.ts` — Registers the `<lens-configurator>` custom element (`LENS_CONFIGURATOR_TAG`). Attaches an open Shadow DOM, binds to the `la:open` storefront event dispatched by the loader, reads mount attributes `data-product-json` and `data-proxy`, parses and normalises `data-product-json` via `productDataSchema` (normalising numeric Shopify IDs to strings and falling back to no-product state on invalid JSON or schema failure), and renders `<ConfiguratorApp />` in shadow DOM. Body scroll is locked while open, and focus is returned to the trigger button on close or when removed from DOM (disconnect).
**Use instead of:** Registering a custom element in another module or managing storefront configurator mounting manually.
**Added by:** spec 16.

### `define-job`
`app/shared/queue/define-job.ts` — Factory for typed background jobs (`defineJob`). Enforces INV-2: payload schema must be a zod object or discriminated union containing only ids/keys (string or number fields matching `/(?:Id|Ids|Key|Keys)$/`), enums, JSON-safe literals, and booleans. Rejects bigints and non-JSON-safe literals (JSON-unsafe), `ZodCatch`, `ZodEffects`, `ZodIntersection`, root optional/nullable/default wrappers, and plain `ZodUnion` (use `ZodDiscriminatedUnion`) at registration. Any string or number field not ending in `Id`/`Ids`/`Key`/`Keys` causes registration to throw `JobDefinitionError` unless explicitly listed in `allowStringFields`. Validates payloads both on enqueue and on receive, throwing a sanitized `JobPayloadValidationError` (path/code only, no plaintext received values) on failure.
**Use instead of:** Unvalidated `pg-boss` send/work calls or hand-rolled retry/dead-letter loops.
**Added by:** spec 08.

### `diopter-type`
`packages/rx-core/src/types/index.ts` — `Diopter`: signed integer hundredths of a diopter (−2.25 D → `-225`).
**Use instead of:** a float or a `number` named `sph`/`cyl`/`add` without a unit.
**Added by:** spec 03.

### `lab-orders-constants`
`app/features/lab-orders/constants.ts` — Leaf module exporting job name constants, schemas, and Shopify GID conversion helpers without pulling Prisma, cipher, or service dependencies into the webhook route (R2-F11):
- `INTAKE_JOB_NAME = "lab-orders.intake"`: Queue name constant for the intake job.
- `DISPATCH_JOB_NAME = "lab-orders.dispatch"`: Queue name constant for the lab order dispatch job.
- `dispatchJobPayloadSchema`: Zod schema for dispatch payload `{ labOrderId: string }`.
- `toOrderGid(id)` / `fromOrderGid(gidOrId)`: Pure string conversion helpers between numeric order ID and `gid://shopify/Order/<id>`.
**Use instead of:** Importing domain services or Prisma into route handlers.
**Added by:** spec 23.

### `money-type`
`packages/rx-core/src/types/index.ts` — `Money` `{ amountMinor, currency }` (ISO-4217).
**Use instead of:** float prices, Shopify decimal strings, or a second money type.
**Added by:** spec 03.

### `orders-create-webhook-route`
`app/routes/webhooks.orders.create.ts` — Webhook action endpoint `POST /webhooks/orders/create`. Authenticates webhook HMAC signature (`authenticate.webhook`, INV-6; invalid signature returns standard 401 JSON shape, non-Response errors rethrown, R2-F7). Strictly validates webhook payload with Zod (`orderWebhookPayloadSchema`, R1-F4, R2-F8; requires positive integer or numeric string id, or numeric gid suffix; empty-suffix gid and non-numeric ids return 400 MALFORMED_PAYLOAD with no enqueue and log error code only, INV-2). Performs zero DB and zero Admin API queries inside the request (INV-8, Self-check 1). Extracts order ID from payload (`payload.id` or `payload.admin_graphql_api_id`), enqueues `lab-orders.intake` job with `{ shopDomain, shopifyOrderId }` only and `singletonKey = shopifyOrderId` (INV-2, INV-8, R2-F9), and returns HTTP 200 immediately.
- **Payload stored in job:** Only `{ shopDomain, shopifyOrderId }`. Full order payload is not persisted to queue (INV-2, INV-8, R2-F9).
- **Architecture:** Route authenticates, validates payload with Zod, and enqueues only. All DB and Admin GraphQL operations run in background jobs.
**Use instead of:** Running order parsing, DB upserts, or Admin API queries synchronously inside Shopify webhook handlers.
**Added by:** spec 23.

### `pd-tenths-mm-type`
`packages/rx-core/src/types/index.ts` — `PdTenthsMm`: integer tenths of a millimetre (63.5 mm → `635`).
**Use instead of:** a float millimetre.
**Added by:** spec 03.

### `prescription-type`
`packages/rx-core/src/types/index.ts` — `Prescription`, `Eye`, `Pd`, `RxType` (`SINGLE_VISION` | `PROGRESSIVE` | `READING` | `NON_PRESCRIPTION`).
**Use instead of:** redeclaring a prescription shape in server or storefront code.
**Added by:** spec 03.

### `prescriptions-schema`
`app/features/prescriptions/schema.ts` — Spec 22 boundary schemas (`manualPrescriptionSubmitSchema`, `uploadPrescriptionSubmitSchema`) and `parsePrescriptionSubmitBody` validating prescription submission payloads. Enforces mutual exclusion: MANUAL requires typed prescription and forbids draftId/uploadedKeys; UPLOAD requires draftId + uploadedKeys and forbids prescription. Ambiguous input returns 400 `AMBIGUOUS_RX_SOURCE` (R4-F1).
**Use instead of:** Loose validation allowing mixed manual and upload payloads.
**Added by:** spec 22.

### `prisma-models`
`prisma/schema.prisma` — MVP models `Shop`, `ShopSettings`, `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`, `Prescription`, `LabOrder`, `ComplianceRequest`. Template `Session` stays as it was.
**Use instead of:** A second schema or ad-hoc tables for catalog, prescriptions, lab orders, or compliance.
**Added by:** spec 02.

### `proxy-catalog-endpoint`
`app/routes/proxy.catalog.ts` — `GET /apps/lens-advisor/catalog` (app route `/proxy/catalog`) returns the full storefront catalog and shopper-facing settings for the verified shop in a single payload. It authenticates app proxy requests via `authenticate.public.appProxy` before running any logic, derives tenancy exclusively from the verified offline session (`session.shop`), verifies that the shop is installed and active in the database, verifies active subscription via `getPlanStatus`, fetches catalog data via `getStorefrontCatalog(shopId)` and settings via `getSettings(shopId)`, shapes the output into the canonical `CatalogResponse` DTO (`lensGroups`, `optionGroups`, `addOns`, `settings: { manualRxEnabled, rxUploadEnabled, storeRxInOrder }`), validates against `catalogResponseSchema`, and returns `200 OK` with `Cache-Control: private, max-age=60`. Unsigned or forged requests return `401 UNAUTHORIZED` with zero service or repository calls (INV-6); uninstalled shops or inactive plans return `404 NOT_AVAILABLE`; upstream billing failures return `502 BILLING_UNAVAILABLE`.
**Use instead of:** storefronts making multiple unauthenticated round-trips for catalog and settings, or reading settings without proxy signature verification.
**Added by:** spec 21.

### `proxy-upload-url-endpoint`
`app/routes/proxy.upload-url.ts` — Storefront app proxy endpoint `POST /apps/lens-advisor/upload-url`. Authenticates proxy signature (`authenticate.public.appProxy`, INV-6), enforces in-memory rate limiting (20 req/min/shop+IP), validates payload `{ contentType, size, draftId? }` via `uploadUrlRequestSchema`, and delegates to `PrescriptionsService.requestUploadUrlByDomain` (R4-F2) to create a draft `Prescription` (source `UPLOAD`) when `draftId` is omitted, returning `{ draftId, uploadUrl, key }` with an SSE-KMS presigned S3 upload URL.
- **Allowed content types:** `image/jpeg`, `image/png`, `image/heic`, `application/pdf`.
- **Upload file size limit:** 1 byte to 10 MB inclusive (1 to 10,485,760 bytes; 0 and > 10 MB rejected).
- **Rate limit:** 20 requests per minute per verified shop domain + client IP.
- **Architecture:** Route authenticates, rate-limits, parses body, and calls one service function with zero repository imports (R4-F2).
**Use instead of:** Unsigned uploads or direct S3 client instantiation from storefront code.
**Added by:** spec 22.

### `queue-container`
`app/shared/container/queue.server.ts` — Client constructor `createPgBoss` and composition root lazy singleton getter `getQueue()` that returns a running `Queue` instance backed by pg-boss in schema `pgboss` (polling mode, Neon pooler safe), with all feature jobs registered alongside their `<name>.dead` dead-letter queues.
**Use instead of:** Instantiating `new PgBoss(...)` outside `app/shared/container/` or creating raw queues in web routes or loaders.
**Added by:** spec 08.

### `rx-core-schemas`
`packages/rx-core/src/schemas/` — zod schemas `diopterSchema`, `axisSchema`, `pdTenthsMmSchema`, `iso4217CurrencySchema`, `moneySchema`, `rxTypeSchema`, `eyeSchema`, `pdSchema`, `prescriptionSchema`, `idSchema`, `rxLimitsSchema`, `lensSchema`, `lensGroupSchema`, `optionGroupKindSchema`, `optionValueSchema`, `optionGroupSchema`, `addOnSchema`, `catalogSettingsSchema`, `catalogResponseSchema`, `selectionSchema`, `prescriptionSubmitBodySchema`, `uploadUrlRequestSchema`. Types are inferred from these schemas, including `PrescriptionSubmitBody` and `UploadUrlRequest`.
**Use instead of:** ad-hoc request/response validators in routes or the configurator client.
**Added by:** spec 03.

### `rx-limits-engine-types`
`packages/rx-core/src/limits/types.ts` (re-exported from `packages/rx-core/src/limits/index.ts`) — types `CheckLensResult`, `FilteredLens`, `LimitExceededReason`, `LimitExceededCode`, `LimitExceededEye`, `LimitExceededField`, `RxTypeLimitReason`, `DiopterLimitReason`.
**Use instead of:** inline reason objects or untyped availability checks.
**Added by:** spec 11.

### `rx-limits-type`
`packages/rx-core/src/types/index.ts` — `RxLimits` inclusive SPH/CYL range, optional ADD range, allowed `RxType[]`.
**Use instead of:** per-feature limit structs.
**Added by:** spec 03.

### `shop-settings-schema`
`app/features/settings/schema.ts` — `parseSettingsPatch`, `defaultShopSettings`, `ValidationError` (400, codes `EMAIL`, `AT_LEAST_ONE_RX_INPUT`, `INVALID`), and the `ShopSettings` / `SetupComplete` types. `EMAIL` is an address zod rejects (`lab@x`, blank). `AT_LEAST_ONE_RX_INPUT` means both `rxUploadEnabled` and `manualRxEnabled` would be off. A stored row that fails those rules is not returned; `getSettings` throws `InternalServerError` `CORRUPT_SETTINGS`.
**Use instead of:** re-validating lab emails or the prescription-input rule in the settings route.
**Added by:** spec 15.

### `ticket-data-type`
`app/features/lab-orders/ticket/types.ts` (re-exported from `app/features/lab-orders/ticket/index.ts`) — `TicketData` interface representing the complete lab ticket payload filled by spec 30: order name/number, frame title and SKU, lens name, lab-code template and chosen options/overrides, option labels, add-on names, prescription (from spec 03), source (`MANUAL` or `UPLOAD`), upload file names, out-of-limits flag (`rxOutOfLimits`), notes, and creation date.
**Use instead of:** ad-hoc or local job ticket types.
**Added by:** spec 24.


## Test helpers and fixtures

### `cipher-container`
`app/shared/container/cipher.server.ts` — Composition root lazy singleton `getCipher()` that builds the shared `FieldCipher` from `getConfig().rx` once. `resetCipher()` drops it (tests).
**Use instead of:** Reading `RX_ENCRYPTION_KEYS` or constructing a cipher in routes, services, or workers.
**Added by:** spec 05.

### `configurator-entries`
`packages/configurator/vite.entries.mjs` — `listEntryNames` and `entryConfigs`: every `src/entries/*.ts` except tests builds to one unhashed IIFE at `extensions/lens-configurator/assets/<name>.js`. `assetsOutDir` is that flat directory. `vite.config.ts` re-exports the module. `scripts/build.mjs` imports the `.mjs` file and runs the configs one at a time, so Node 22.12 can build without type stripping.
**Use instead of:** A second storefront bundler, hashed filenames, or ES module output the theme block cannot load.
**Added by:** spec 04.

### `configurator-package`
`packages/configurator/package.json` — Private Preact library (`preact` 11.2.0). No `exports` map: callers use the built theme assets, or import the entry modules below from source in tests.
**Use instead of:** Publishing this package, or importing `extensions/lens-configurator/assets/*.js` from app code.
**Added by:** spec 04.

### `e2e-cart-url`
`e2e/helpers/cart-url.ts` — `buildCartUrl(pageUrlOrOrigin, path)`. Resolves absolute cart URLs against the current page URL or base URL for Playwright storefront request contexts.
**Use instead of:** hardcoded relative endpoints in `page.request` calls.
**Added by:** spec 33.

### `e2e-queue-mock`
`e2e/helpers/queue-mock.ts` — `createMockQueue()`, `setupQueueMock()`, `teardownQueueMock()`. Queue seam adapter capturing enqueued jobs across Node and Vite module runtimes while routing them to pg-boss in a run-scoped schema on the test database. Filters out deduped singletons returning null (R5-F1).
**Use instead of:** live pg-boss worker polling during server e2e tests.
**Added by:** spec 33.

### `e2e-seed-helpers`
`e2e/helpers/seed.ts` — `seedShop`, `seedLensGroup`, `seedLens`, `seedOptionGroup`, `seedAddOn`, `seedSettings`. Seed helpers invoking service layers (specs 14, 15, 17) rather than direct SQL.
**Use instead of:** raw SQL seeding in end-to-end suites.
**Added by:** spec 33.

### `e2e-shared-db`
`e2e/helpers/shared-db.ts` — `getSharedTestDb()`, `resetSharedTestDb()`, `teardownSharedTestDb()`, `getSchemaTrackingFile()`, and `getPgbossSchemaTrackingFile()`. Creates a single migrated PostgreSQL schema on `TEST_DATABASE_URL` tracked with a run-unique PID-based file and shared across the in-process server test run so Shopify PrismaSessionStorage references stay valid across sequential spec files, with `resetSharedTestDb()` providing per-test shop row cleanup.
**Use instead of:** recreating separate schemas per test file in Playwright test suites.
**Added by:** spec 33.

### `e2e-shopify-auth-fixtures`
`e2e/helpers/shopify-auth.ts` — `createSessionToken`, `createAuthHeaders`, `createAdminUrl`, `createSignedProxyRequest`, `createSignedWebhookRequest`, `createLoaderArgs`, `createActionArgs`, `getResponseStatus`, and `unwrapData`. Signed request builders for Shopify admin requests, proxy signatures, and webhook HMAC verification conforming to INV-6.
**Use instead of:** custom signature implementations or manually formatted auth headers in e2e tests.
**Added by:** spec 33.

### `e2e-shopify-mock`
`e2e/helpers/shopify-mock.ts` — `setupShopifyMock`, `teardownShopifyMock`, `setMockPlanActive`, `setMockOrder`, `clearMockOrders`. Intercepts `globalThis.fetch` for Shopify Admin GraphQL and Partners subscription queries.
**Use instead of:** live network requests to Shopify APIs in server e2e tests.
**Added by:** spec 33.

### `e2e-standalone-number`
`e2e/helpers/standalone-number.ts` — `standaloneNumber(value)`. Regex builder matching numbers unless bordered by letters, digits, or dots, preserving clinical unit-suffixed matches while rejecting cuid IDs and ISO timestamps.
**Use instead of:** raw substring checks for clinical values in privacy assertions.
**Added by:** spec 33.

### `e2e-storage-mail-mock`
`e2e/helpers/storage-mail-mock.ts` — `createMockObjectStore`, `createMockMailer`, `setupStorageAndMailerMocks`, `teardownStorageAndMailerMocks`. In-memory storage and mailer adapters capturing ticket uploads and notification dispatches.
**Use instead of:** live S3 or Resend API calls during server e2e flows.
**Added by:** spec 33.

### `e2e-vite-loader`
`e2e/helpers/vite.ts` — `getViteServer()`, `loadServerModule(path)`, and `closeViteServer()`. In-process custom Vite dev server runner for loading server modules with `import.meta.glob` support during e2e tests.
**Use instead of:** executing Vite-dependent route modules in plain Node.
**Added by:** spec 33.

### `get-plan-status`
`app/features/billing/plan.server.ts` — `getPlanStatus(request, admin)` (or `getPlanStatus(admin)`) queries canonical Shopify App Pricing via Partner API `activeSubscription(appId, shopId)`, falling back to Admin GraphQL `currentAppInstallation.activeSubscriptions` only when `activeSubscription` is null; a shop is unpaid only when both are empty. Returns `{ active, planName?, test }` and is memoized per request. Any failure (network, non-OK HTTP, malformed body, GraphQL `errors`, missing credentials) throws `AppError(502, "BILLING_UNAVAILABLE")`; it never reports "no plan" on an outage.
**Use instead of:** ad-hoc `currentAppInstallation` subscription queries, or `billing.request` (Shopify App Pricing forbids it).
**Added by:** spec 09.

### `render-in-shadow`
`packages/configurator/src/test/render-in-shadow.ts` — `renderInShadow(ui, { css })` renders Preact into an open shadow root. Returns the Testing Library result plus `host` and `shadowRoot` (`ShadowRenderResult`).
**Use instead of:** Rendering configurator UI into `document.body` in tests.
**Added by:** spec 04.

### `seed-shop`
`test/db.ts` — `seedShop(db, domain)` inserts one shop and one fixture row in every shop-owned table.
**Use instead of:** Hand-rolling a shop fixture per feature test.
**Added by:** spec 02.

### `shop-settings`
`app/features/settings/settings.service.server.ts` — `getSettings(shopId, db?)` returns the shop's settings, or defaults when no row exists (`labEmail: []`, `ticketFormat: "PDF"`, `storeRxInOrder: false`, both prescription inputs on) and does not insert. `updateSettings(shopId, patch, db?)` validates the patch, merges it, and upserts one row for that shop. `isSetupComplete(shopId, db?)` returns `{ labEmail: boolean }` (true when at least one address is saved) and does not insert. `isComplete` is the same function. The public address field is `labEmail` (string or string array on input, string array on output), stored in the Prisma column `labEmails`. Omit `db` in the app; it defaults to the container client. Pass the `createTestDb()` client in tests.
**Use instead of:** reading or writing `ShopSettings` from a route, or a second settings model.
**Added by:** spec 15.

### `test-db`
`test/db.ts` — `createTestDb()` creates schema `t_<random>` on `TEST_DATABASE_URL`, runs `prisma migrate deploy`, and returns a Prisma client plus `drop()`.
**Use instead of:** Sharing one database across tests, or running migrations against the app database from a test.
**Added by:** spec 02.
