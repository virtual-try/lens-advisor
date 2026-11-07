# Spec 04 — Configurator package, tokens and theme app block

**Status:** Not started
**Depends on:** Spec 01
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `packages/configurator/package.json`, `packages/configurator/tsconfig.json`, `packages/configurator/vite.config.ts`, `packages/configurator/src/entries/`, `packages/configurator/src/styles/`, `packages/configurator/src/test/`, `extensions/lens-configurator/shopify.extension.toml`, `extensions/lens-configurator/blocks/`, `extensions/lens-configurator/locales/`, `specs/inventory/04-configurator-package-and-tokens.md`
**Reuses:** `DESIGN-SYSTEM.md`, `design/v3/product.html`, `../docs/research/stack.md`
**Kind:** scaffold, ui
**Invariants:** INV-7, INV-9

## Goal

The storefront side exists end to end with no features: a Vite + Preact library build that emits one flat
file per entry into the theme extension's `assets/`, the design tokens as CSS custom properties, and an app
block that renders the "Select lenses" button and lazy-loads the configurator.

## Scope

- `packages/configurator`: Preact, Vite library mode, every `src/entries/*.ts` → `extensions/lens-configurator/assets/<name>.js`
  (flat, no subfolders, no hashed names). Entries now: `loader.ts` (tiny: finds the mount point, on click
  injects `configurator.js` once) and `configurator.ts` (defines nothing yet — spec 16 fills the element).
- `src/styles/tokens.css`: every token in `DESIGN-SYSTEM.md`, under `:host` (Shadow DOM), as `--la-*`
  custom properties; merchant-overridable ones read an outer `--la-merchant-*` fallback chain. The only file
  in the package with raw values (INV-7).
- `src/test/`: Vitest + `@testing-library/preact` + jsdom setup, a `renderInShadow` helper.
- Theme block `blocks/select-lenses.liquid`: renders the button (label from block settings, default from
  `locales/en.default.json`), a mount `<div>` with `data-product-json` (product id, variant ids, price in
  minor units, currency), `data-proxy="/apps/lens-advisor"`, and loads `loader.js` deferred. Block settings:
  button label, accent colour override, corner radius override.
- Bundle-size check script: `loader.js` ≤ 10 KB minified (stack.md §3 guidance); prints sizes.

## Explicit non-scope

- The `<lens-configurator>` element, reducer and API client → spec 16. Steps → specs 26–29.
- Product-page placement docs for merchants → spec 31's checklist links to the theme editor.

## Reuse first

- Tokens transcribed from `DESIGN-SYSTEM.md`, not re-derived from the prototype CSS.
- Do not paste `design/v3` HTML/CSS; rebuild the button from tokens.

## Wiring

Real, used now: theme block → `loader.js`; click → loads `configurator.js` (which only registers an empty element until spec 16).
Stubbed: none in production — until spec 16 the click opens nothing visible; the block is not added to any live theme before spec 33.

## Steps

1. Package + Vite config with the entries glob; build writes to `extensions/lens-configurator/assets/`.
2. `tokens.css` from DESIGN-SYSTEM.md; the block + locales; loader.
3. Tests: loader injects the script once on two clicks; tokens file defines every DESIGN-SYSTEM token.

## Self-check

1. Built files land flat in `assets/` with stable names (no hash) — Liquid references them by name.
2. The loader works when the block appears twice on a page (two mount points, one script injection).
3. UI checklist (`spec-quality.md` §8): button ≥ 44 px target, visible focus, label from locale file.

## Done when

- [x] `pnpm vitest run packages/configurator/src/entries` passes: two clicks inject `configurator.js` once; two mount points both open. [unit]
- [x] A test parses `DESIGN-SYSTEM.md`'s token tables and asserts each token name is defined in `tokens.css`. [unit]
- [x] INV-7: `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' packages/configurator/src --glob '!tokens.css'` finds nothing. [static]
- [x] INV-9: the button label comes from `locales/en.default.json` via block settings; no literal label in Liquid or TS. [static]
- [x] `pnpm --filter configurator build` writes `loader.js` and `configurator.js` to `extensions/lens-configurator/assets/`; the size script reports `loader.js` ≤ 10 KB. [static]
- [ ] The block can be added to a dev store product template in the theme editor and the button renders. [requires: Shopify dev store]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/04-configurator-package-and-tokens.md` lists the entries contract, `renderInShadow`, the tokens file. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 04 built in this worktree (not committed):
  - `packages/configurator`: private Preact 11.2.0 library. `src/entries/loader.ts` and `src/entries/configurator.ts` build as unhashed IIFEs into `extensions/lens-configurator/assets/`. The loader binds `[data-la-mount]`, injects `configurator.js` once, and dispatches `la:open`. The configurator entry registers an empty `lens-configurator` element for spec 16.
  - `src/styles/tokens.css` transcribes every `DESIGN-SYSTEM.md` token. `src/styles/button.css` and `block.css` use only those custom properties. `renderInShadow` mounts Preact in an open shadow root. `scripts/check-bundle-size.mjs` requires a flat asset dir and `loader.js` ≤ 10 KB minified.
  - Theme block `extensions/lens-configurator/blocks/select-lenses.liquid` plus `locales/en.default.json` and `en.default.schema.json`. Button label is the block setting, else the storefront locale key. Mount carries `data-product-json`, `data-proxy="/apps/lens-advisor"`, and `data-configurator-src`.
  - Deviations: root `vitest.config.ts` gained a `configurator` project (jsdom, package setup file) so `pnpm test` runs these tests; root `package.json` gained the `jsdom` devDependency that project needs. Root `eslint.config.js` ignores generated `extensions/**/assets/**`, and `**/*.mjs` gets Node globals so the size script's `console` and `process` type-check under `no-undef` without turning the rule off. Tokens sit on `:host` and `.la-block` because the trigger renders outside the shadow root and merchant custom properties on `.la-block` must inherit inward. The block loads the loader through the schema `javascript` key (`loader.js`), which injects a classic script, so the library build is IIFE rather than a `<script defer>` written in the Liquid body.
  - Proved this session: entries vitest 7/7; token-table test inside `pnpm test` 40/40, 0 failures; INV-7 `rg` found nothing; INV-9 held by the block contract (no literal label in Liquid or TS); size script reported `loader.js` 1314 B against a 10240 B limit; `pnpm typecheck` and `pnpm lint` (`--max-warnings 0`) exited 0; `pnpm build` exited 0. Inventory fragment written.
- **2026-11-08** — Theme-editor box left open. It needs a Shopify dev store, which this spec marks owner-gated. Not run here.
- **2026-11-07** — Evidence (orchestro spec verify, tree 06a75649): install pass · typecheck pass · lint pass · build pass · test pass 41/0/0
