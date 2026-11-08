# Inventory fragment — Spec 27 (Configurator steps 3–4: lens group and lens, with Rx limits)

### `configurator-step-lens-group`
`packages/configurator/src/steps/03-lens-group/index.tsx` — Step 3 of the storefront configurator (`id: "lens-group"`, `titleKey: "lens_group"`). Displays lens groups as cards with name, description, and "from <price>" derived from the minimum price among lenses supporting the shopper's prescription type (`rxType`). Automatically filters out groups with zero lenses for the active `rxType`. Selecting a group updates the selection in the step store (`setSelectedLensGroupId`) and clears `selection.lensId` if reparented. Exports the standard `StepModule` contract (`id`, `titleKey`, `isComplete`, `isApplicable`, `Component`).
**Use instead of:** Hardcoded group selection components or unfiltered group listings.
**Added by:** spec 27.

### `configurator-step-lens`
`packages/configurator/src/steps/04-lens/index.tsx` — Step 4 of the storefront configurator (`id: "lens"`, `titleKey: "lens"`). Displays lenses belonging to the chosen group as radio cards with formatted prices. Evaluates optical availability using `filterLenses` against the in-memory prescription and `rxType`. Orders lenses with available lenses first (maintaining catalog order) followed by unavailable lenses (maintaining catalog order). Disabled lenses are marked with `disabled` and `aria-disabled="true"`, with reasons linked via `aria-describedby` for screen reader announcements. Arrow keys in the radiogroup skip disabled lenses. When every lens is unavailable, renders an explanation banner with a "Change prescription" button that dispatches `GO_TO_STEP` to return to Step 2. Exports the standard `StepModule` contract (`id`, `titleKey`, `isComplete`, `isApplicable`, `Component`).
**Use instead of:** Ad-hoc lens selection views or unvalidated limit checks in the storefront.
**Added by:** spec 27.

### `configurator-option-card`
`packages/configurator/src/steps/03-lens-group/OptionCard.tsx` — Shared choice-card component (`OptionCard`) implementing the DESIGN-SYSTEM.md choice card pattern. Renders a radio input with accessible touch target (min 44 px via `--la-target`), custom checkmark (`.la-mark`), title, optional badge, optional description, price, and accessible disabled reason line (`.la-choice__reason`). Styles adhere strictly to `tokens.css` with zero raw values (INV-7).
**Use instead of:** Writing custom radio/choice card markup in configurator steps.
**Added by:** spec 27.

### `configurator-lens-group-store`
`packages/configurator/src/steps/03-lens-group/store.ts` — Shared state accessor for the chosen lens group (`getSelectedLensGroupId`, `setSelectedLensGroupId`, `clearSelectedLensGroupId`). Derives the active group from `state.selection.lensId` when a lens is selected, or falls back to the in-memory selected group ID.
**Use instead of:** Global ad-hoc group selection variables.
**Added by:** spec 27.

### `configurator-lens-format-reason`
`packages/configurator/src/steps/04-lens/format-reason.ts` — Formats structured `LimitExceededReason` objects from the limits engine (`SPH_BELOW_MIN`, `SPH_ABOVE_MAX`, `CYL_OUT_OF_RANGE`, `ADD_OUT_OF_RANGE`, `RX_TYPE_NOT_SUPPORTED`) into human-readable strings via `strings.ts` templates and `formatDiopter` (INV-5), normalizing hyphen to typographic minus (`\u2212`).
**Use instead of:** Re-implementing diopter formatting or writing unformatted diopter values.
**Added by:** spec 27.
