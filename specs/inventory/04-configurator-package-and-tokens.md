# Inventory fragment — Spec 04 (Configurator package, tokens and theme app block)

### `configurator-package`
`packages/configurator/package.json` — Private Preact library (`preact` 11.2.0). No `exports` map: callers use the built theme assets, or import the entry modules below from source in tests.
**Use instead of:** Publishing this package, or importing `extensions/lens-configurator/assets/*.js` from app code.
**Added by:** spec 04.

### `configurator-entries`
`packages/configurator/vite.config.ts` — `listEntryNames` and `entryConfigs`: every `src/entries/*.ts` except tests builds to one unhashed IIFE at `extensions/lens-configurator/assets/<name>.js`. `assetsOutDir` is that flat directory. `scripts/build.mjs` runs the configs one at a time.
**Use instead of:** A second storefront bundler, hashed filenames, or ES module output the theme block cannot load.
**Added by:** spec 04.

### `configurator-loader`
`packages/configurator/src/entries/loader.ts` — Storefront loader. Exports `MOUNT_SELECTOR` (`[data-la-mount]`), `OPEN_SELECTOR` (`[data-la-open]`), `CONFIGURATOR_SCRIPT_SELECTOR`, `OPEN_EVENT` (`la:open`), `OpenDetail`, `injectConfigurator` (one `configurator.js` per document), `dispatchOpen`, `bindMount`, `bindAll`, `bootWhenReady`.
**Use instead of:** A second click-to-inject script, or a `<script>` tag for `configurator.js` in Liquid.
**Added by:** spec 04.

### `lens-configurator-tag`
`packages/configurator/src/entries/configurator.ts` — Exports `LENS_CONFIGURATOR_TAG` (`lens-configurator`) and registers an empty custom element so the built script is not a no-op. Spec 16 fills the element.
**Use instead of:** Defining `<lens-configurator>` in another file, or a second custom-element tag.
**Added by:** spec 04.

### `select-lenses-block`
`extensions/lens-configurator/blocks/select-lenses.liquid` — Product-template app block. The mount exposes `data-product-json` (product id, variant ids, price in minor units, currency), `data-proxy="/apps/lens-advisor"`, and `data-configurator-src`. Button text is `block.settings.button_label`, or `select_lenses.button_label` from `locales/en.default.json`. Schema `javascript` loads `loader.js`; `stylesheet` loads `loader.css`. Settings write `--la-merchant-accent` and `--la-merchant-radius` on `.la-block`.
**Use instead of:** A hard-coded button label, a script tag in the Liquid body, or a second product mount.
**Added by:** spec 04.

### `configurator-tokens`
`packages/configurator/src/styles/tokens.css` — Every `--la-*` token from `specs/DESIGN-SYSTEM.md`, on `:host` and `.la-block`. Merchant overrides fall through `--la-merchant-accent`, `--la-merchant-font-family`, and `--la-merchant-radius`. The only file in the package with raw colour, size, or duration values.
**Use instead of:** Raw colours, pixel sizes, or durations in configurator CSS or components.
**Added by:** spec 04.

### `render-in-shadow`
`packages/configurator/src/test/render-in-shadow.ts` — `renderInShadow(ui, { css })` renders Preact into an open shadow root. Returns the Testing Library result plus `host` and `shadowRoot` (`ShadowRenderResult`).
**Use instead of:** Rendering configurator UI into `document.body` in tests.
**Added by:** spec 04.

### `bundle-size-check`
`packages/configurator/scripts/check-bundle-size.mjs` — Runs at the end of `scripts/build.mjs`. Requires `assets/` to be exactly `configurator.js`, `loader.css`, and `loader.js`, with no subfolders, and `loader.js` ≤ 10 KB minified (not gzip).
**Use instead of:** A gzip budget, or a size check that lives only outside the package build.
**Added by:** spec 04.
