# Spec 34 — Verification pass

**Status:** Not started
**Depends on:** Spec 33
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `specs/INVENTORY.md`
**Reuses:** `INVARIANTS.md`, `ARCHITECTURE.md`, `DESIGN-SYSTEM.md`, `INVENTORY.md`

## Goal

The final gate. Prove from a clean state that what the spec set promised is actually true — and record
every place it was not. This spec observes and reports; anything found becomes a new spec.

## Scope

- Clean rebuild: fresh `pnpm install --frozen-lockfile`, typecheck, lint, build (app + configurator bundle).
- Every earlier spec's `Done when` re-checked against the real artifact, not the ticked box.
- Whole unit suite and whole e2e suite, each in one go.
- Fold `specs/inventory/*.md` into `INVENTORY.md`; duplication sweep.
- Steering docs re-read against the code; every `INV-1`…`INV-10` checked by ID.
- Storefront budget: the loader file in `extensions/lens-configurator/assets/` is ≤ 10 KB (theme-check
  guidance); record the configurator bundle size from the build output.

## Explicit non-scope

- Fixing anything found → each finding becomes its own numbered spec in `README.md` and `PROGRESS.md`.
- New features of any kind.

## Steps

1. Clean install; `pnpm typecheck`, `pnpm lint`, `pnpm build`; record real output.
2. `pnpm test`, then `pnpm test:e2e`; record both runner summary lines verbatim.
3. Walk every earlier spec's `Done when`; note every box that does not hold.
4. Fold inventory fragments; run the sweep (near-duplicate exports, raw hex outside `tokens.css`/`design/`,
   inventory entries whose file is gone).
5. Re-read `ARCHITECTURE.md` against the tree (structural invariants 1–7 by grep) and `INVARIANTS.md` by ID.
6. Re-open every `[requires: …]` box left open and every Examples table; grep production code for stubs
   named in `## Wiring` sections.
7. Re-read `DESIGN-SYSTEM.md` against `packages/configurator/src/styles/tokens.css` and component styles.
8. Run `shopify app deploy --dry-run` if available, else `shopify app config validate`; record output.
9. Record everything in the Log with tool output; file follow-up specs.

## Done when

- [x] Clean install + `pnpm typecheck` + `pnpm lint` (0 errors, 0 warnings) + `pnpm build` all pass. [static]
- [x] Whole unit suite and whole e2e suite pass from a clean install; summary lines quoted verbatim in the Log. [suite]
- [x] Every inventory fragment is folded into `INVENTORY.md`. [static]
- [x] Every earlier spec's `Done when` re-checked and the result recorded. [static]
- [x] Duplication sweep run; findings in the Log. [static]
- [x] Every `INV-N` in `INVARIANTS.md` checked against the tree, by ID. [static]
- [x] No stub named in any `## Wiring` section remains in production code. [static]
- [ ] No token used outside `DESIGN-SYSTEM.md`'s list. [static]
- [x] The theme-extension loader asset is ≤ 10 KB (size from the build output). [static]
- [x] Every finding has a follow-up spec or a line saying why it is accepted. [static]

## Log

- **2026-11-09** — Clean rebuild verification (R1-F1):
  - Clean state proven: executed `rm -rf node_modules packages/*/node_modules build .react-router extensions/lens-configurator/assets/* packages/configurator/dist`. Verified directories and bundle outputs fully removed prior to rerun.
  - `pnpm install --frozen-lockfile`:
    ```
    Scope: all 3 workspace projects
    Lockfile is up to date, resolution step is skipped
    Packages: +827
    Progress: resolved 827, reused 827, downloaded 0, added 827, done
    . postinstall$ prisma generate
    ✔ Generated Prisma Client (v6.19.2) to ./node_modules/.pnpm/@prisma+client@6.19.2_prisma@6.19.2_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client
    dependencies: +20 devDependencies: +22
    Done in 891ms using pnpm v12.18.0
    Exit code: 0
    ```
  - `pnpm typecheck`:
    ```
    $ prisma generate && react-router typegen && tsc --noEmit && pnpm -r typecheck
    ✔ Generated Prisma Client (v6.19.2) to ./node_modules/.pnpm/@prisma+client@6.19.2_prisma@6.19.2_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client in 46ms
    packages/configurator typecheck$ tsc --noEmit (Done in 745ms)
    packages/rx-core typecheck$ tsc --noEmit (Done in 1.4s)
    Exit code: 0
    ```
  - `pnpm lint`:
    ```
    $ eslint . --max-warnings 0
    Exit code: 0 (0 errors, 0 warnings)
    ```
  - `pnpm build`:
    ```
    $ prisma generate && react-router build && pnpm -r build
    ✔ Generated Prisma Client (v6.19.2) in 60ms
    vite v7.3.7 building client environment for production... ✓ 397 modules transformed.
    build/client/.vite/manifest.json                              9.58 kB │ gzip:  1.20 kB
    build/client/assets/route-Xpdx9QZl.css                        0.76 kB │ gzip:  0.35 kB
    vite v7.3.7 building ssr environment for production... ✓ 123 modules transformed.
    build/server/.vite/manifest.json                              0.23 kB
    build/server/index.js                                       523.30 kB
    packages/rx-core build$ tsc --noEmit (Done in 752ms)
    packages/configurator build$ node scripts/build.mjs
    ../../extensions/lens-configurator/assets/configurator.js  202.38 kB │ gzip: 56.66 kB
    ../../extensions/lens-configurator/assets/loader.css  3.32 kB │ gzip: 1.33 kB
    ../../extensions/lens-configurator/assets/loader.js   1.31 kB │ gzip: 0.71 kB
    configurator.js 202380 B (197.64 KB)
    loader.css 3319 B (3.24 KB)
    loader.js 1314 B (1.28 KB), limit 10240 B
    Exit code: 0
    ```
- **2026-11-09** — Test suite runner summaries from clean rebuild (R1-F1):
  - Unit suite (`pnpm test` / `vitest run`):
    ```
    Test Files  72 passed (72)
    Tests  1307 passed (1307)
    Start at  02:30:30
    Duration  14.31s (transform 8.72s, setup 1.41s, collect 26.86s, tests 67.88s, environment 13.53s, prepare 4.27s)
    Exit code: 0
    ```
  - Server end-to-end suite (`pnpm test:e2e --project=server` / `playwright test --project=server`):
    ```
    30 passed (3.0s)
    Exit code: 0
    ```
  - Full end-to-end suite (`pnpm test:e2e` / `playwright test`):
    ```
    5 skipped
    30 passed (3.7s)
    Exit code: 0
    ```
    (Note: 5 skipped tests are in `e2e/storefront/` and require a live Shopify dev store with `E2E_STORE_URL` and `E2E_STORE_PASSWORD`).
- **2026-11-09** — Inventory folding:
  - Folded all 143 fragment entries across 33 files in `specs/inventory/*.md` into `specs/INVENTORY.md` categorized across 9 architectural sections:
    - Components (admin — Polaris): 4 entries
    - Components (configurator — Preact): 13 entries
    - Hooks: 0 entries
    - API / services: 41 entries
    - Domain logic (packages/rx-core): 20 entries
    - Utils: 18 entries
    - Constants: 7 entries
    - Types and schemas: 23 entries
    - Test helpers and fixtures: 17 entries
  - Verified 143/143 primary file paths exist on disk (0 missing).
  - Verified 143/143 anchors are unique (0 duplicates).
- **2026-11-09** — Duplication sweep (Step 4, R1-F3):
  - Scope: near-duplicate exports across features, raw hex outside `tokens.css`/`design/`, inventory entries whose file is gone.
  - Part A — Inventory entries file existence:
    - Command: `python3 -c "import os, re; ... check all paths in specs/INVENTORY.md exist ..."`
    - Result: 152 file references in `specs/INVENTORY.md`; 152/152 paths exist on disk (0 missing).
  - Part B — Raw hex search outside `tokens.css` and `design/`:
    - Command: `rg -i '#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b' app/ packages/ --glob '!**/tokens.css' --glob '!**/design/**' --glob '!**/*.md' --glob '!**/*.json' --glob '!node_modules/**' --glob '!.react-router/**' --glob '!build/**'`
    - Results and disposition:
      - `app/features/lab-orders/ticket/pdf-renderer.ts` (10 hits: `#FFF3CD`, `#856404`, `#000000`, `#CCCCCC`, `#C0392B`, `#F0F0F0`, `#DDDDDD`, `#333333`): Accepted-why: PDFKit server-side vector drawing canvas producing print lab tickets; PDFKit has no CSS DOM/stylesheet engine and does not evaluate CSS custom properties.
      - `app/features/catalog/admin-options.test.tsx` (6 hits: `#555555`, `#006400`, `#ffffff`, `#add-option-group-modal`): Accepted-why: swatch color test fixtures and HTML DOM ID selector in unit tests.
      - `app/features/lab-dispatch/dispatch.test.ts` & `admin-lab-orders.test.tsx` (24 hits: `#501`, `#123`, etc.): Accepted-why: Shopify order name identifiers prefixed with `#` matched by hex pattern.
      - `packages/configurator`: 0 raw hex occurrences outside `tokens.css`.
  - Part C — Near-duplicate exports across features:
    - Command: AST/export scanner over TypeScript source files in `app/` and `packages/` (excluding tests, test helpers, re-export barrels, and standard React Router route exports).
    - Results and disposition:
      - `dispatchJob` (`app/features/lab-orders/jobs.server.ts` vs `app/features/lab-dispatch/jobs.server.ts`): Accepted-why: producer job contract definition in `lab-orders` (Spec 23) vs worker executable handler definition in `lab-dispatch` (Spec 30); `lab-dispatch` registers handler on pg-boss queue while `lab-orders` defines enqueue payload schema.
      - `ValidationError` (`app/features/catalog/schema.ts` vs `app/features/settings/schema.ts`): Accepted-why: independent feature domain validation classes subclassing `BadRequestError` with domain-specific field schemas.
      - `findShopByDomain` (`app/features/compliance/repository.server.ts` vs `app/features/prescriptions/prescriptions.repository.server.ts`): Accepted-why: feature-isolated database queries per architectural invariant 1 (features own their DB queries).
      - `OptionGroupWithValues` (`app/features/catalog/catalog.repository.server.ts` vs `app/routes/app.options._index.tsx`): Accepted-why: repository layer entity type (`OptionGroup & { values: OptionValue[] }`) vs route presentation DTO (`CatalogOptionGroupDto & { values: CatalogOptionValueDto[] }`).
      - `UploadUrlResponse` (`app/features/prescriptions/prescriptions.service.server.ts` vs `packages/configurator/src/shared/api.ts`): Accepted-why: server endpoint response type vs client SDK response type, maintaining strict package decoupling between configurator and app backend.
      - `Summary` component (`packages/configurator/src/steps/05-options/index.tsx` vs `packages/configurator/src/steps/06-add-ons/index.tsx`): Accepted-why: step-specific Preact sidebar summary components satisfying `StepModule` interface.
      - `strings` (`packages/configurator/src/*/strings.ts`): Accepted-why: localized strings dictionary per component satisfying INV-9.
      - `nav` (`app/features/*/nav.ts`): Accepted-why: Polaris navigation configuration per admin feature.
      - Repository/Service pairs (`createLens`, `updateLens`, etc. in `app/features/catalog/`): Accepted-why: standard layered service pattern wrapping repository operations with validation and shop scoping.
- **2026-11-09** — Earlier specs Done-when walk (Specs 00–33, R1-F2, R2-F1):
  - Walked every checkbox in `## Done when` across all earlier specs (00–33). Restricting the recheck strictly to specs 00–33 yields exactly 267 checkboxes across 34 specs (252 holding, 14 owner-gated open, 1 not holding).
  - Per-spec breakdown table:

| Spec | Title | Boxes | Held | Owner-gated open (with reason) | Not holding |
|---|---|---|---|---|---|
| 00 | Stack, storage, testing and design decision | 3 | 3 | 0 | 0 |
| 01 | App scaffold, workspace and unit harness | 8 | 6 | 1 (`[requires: Shopify Partner account, dev store — owner provides]`) | 1 (`rg 'process.env' app packages --glob '!app/shared/config.server.ts'` returns 15 hits in `app/shared/storage/object-store.server.test.ts`) |
| 02 | Database schema and first migration | 10 | 10 | 0 | 0 |
| 03 | rx-core domain types and schemas | 9 | 9 | 0 | 0 |
| 04 | Configurator package, tokens and theme app block | 10 | 9 | 1 (`[requires: Shopify dev store]`) | 0 |
| 05 | Field encryption for prescription data | 7 | 7 | 0 | 0 |
| 06 | S3 storage adapter | 8 | 7 | 1 (`[requires: AWS account, bucket, KMS key — owner provides]`) | 0 |
| 07 | Mailer adapter (Resend) | 7 | 6 | 1 (`[requires: Resend account, verified sending domain — owner provides]`) | 0 |
| 08 | Job queue and worker process (pg-boss) | 7 | 7 | 0 | 0 |
| 09 | Plan gate (Shopify managed pricing) | 6 | 5 | 1 (`[requires: Shopify dev store, plans configured in Partner Dashboard]`) | 0 |
| 10 | Rx parser and validation | 7 | 7 | 0 | 0 |
| 11 | Rx limits engine | 7 | 7 | 0 | 0 |
| 12 | Lab code compiler | 5 | 5 | 0 | 0 |
| 13 | Price calculation | 6 | 6 | 0 | 0 |
| 14 | Catalog repository and service | 8 | 8 | 0 | 0 |
| 15 | Shop settings repository and service | 7 | 7 | 0 | 0 |
| 16 | Configurator shell, state machine and API client | 9 | 9 | 0 | 0 |
| 17 | Shopify product sync for lenses, options and add-ons | 8 | 7 | 1 (`[requires: Shopify dev store]`) | 0 |
| 18 | Admin: lens groups and lenses | 9 | 8 | 1 (`[requires: Shopify dev store]`) | 0 |
| 19 | Admin: lens options and add-ons | 8 | 8 | 0 | 0 |
| 20 | Admin: settings page | 8 | 8 | 0 | 0 |
| 21 | App proxy: storefront catalog endpoint | 9 | 8 | 1 (`[requires: Shopify dev store]`) | 0 |
| 22 | App proxy: prescription submit and upload endpoints | 9 | 8 | 1 (`[requires: Shopify dev store, AWS bucket]`) | 0 |
| 23 | orders/create webhook → lab orders | 10 | 9 | 1 (`[requires: Shopify dev store, protected customer data Level 1 enabled]`) | 0 |
| 24 | Lab job ticket renderer (PDF and CSV) | 7 | 7 | 0 | 0 |
| 25 | Compliance and uninstall webhooks | 11 | 10 | 1 (`[requires: Shopify CLI, dev app]`) | 0 |
| 26 | Configurator steps 1–2: Rx type and prescription | 8 | 8 | 0 | 0 |
| 27 | Configurator steps 3–4: lens group and lens, with Rx limits | 8 | 8 | 0 | 0 |
| 28 | Configurator steps 5–6: options, add-ons and price summary | 8 | 8 | 0 | 0 |
| 29 | Configurator step 7: review and add to cart (nested lines) | 10 | 9 | 1 (`[requires: Shopify dev store with the app block placed]`) | 0 |
| 30 | Lab order dispatch job (ticket → S3 → email) | 9 | 8 | 1 (`[requires: Resend API key + verified domain, S3 bucket with KMS key]`) | 0 |
| 31 | Admin home and setup checklist | 7 | 7 | 0 | 0 |
| 32 | Admin: lab orders list, resend and ticket download | 8 | 8 | 0 | 0 |
| 33 | End-to-end suite | 6 | 5 | 1 (`[requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL]`) | 0 |
| **Total** | **Specs 00–33 (34 specs)** | **267** | **252** | **14** | **1** |

- **2026-11-09** — Invariants verification by ID:
  - `INV-1` (Tenancy): Not fully holding. Repository function `getLabOrderShopId` in `app/features/lab-dispatch/lab-dispatch.repository.server.ts` performs an unscoped lookup (`findUnique({ where: { id: labOrderId } })`) without `shopId` filtering to resolve the owning shop from a `{ labOrderId }` queue payload. Follow-up Spec 37 filed to require `{ shopId, labOrderId }` in the job payload and scope `getLabOrderShopId` by `{ id, shopId }` with two-shop isolation tests (R3-F2).
  - `INV-2` (Encryption & Logging): AES-256-GCM cipher with per-record AAD; S3 SSE-KMS storage; 0 logger statements pass Rx data; error envelopes redact data.
  - `INV-3` (Shopify Rx Leak Prevention): `storeRxInOrder` defaults false; only `_rx_ref` and human summary in cart line item properties; 0 plaintext Rx strings in cart properties.
  - `INV-4` (Integer Money): Minor units int + currency; `parseFloat`/`toFixed` grep finds 0 occurrences on money fields across `app/` and `packages/`.
  - `INV-5` (Diopter Units): Integer hundredths for SPH/CYL/ADD and integer tenths of mm for PD enforced in zod schemas and domain models.
  - `INV-6` (Verification at Boundary): Not holding for two webhook routes: `app/routes/webhooks.app.scopes_update.tsx` (unvalidated cast `payload.current as string[]` without Zod validation before database update) and `app/routes/webhooks.products.update.tsx` (logs raw unvalidated payload via `console.log(JSON.stringify(payload, null, 2))` instead of validating with Zod and logging safe IDs only). Follow-up Spec 38 filed to Zod-validate both payloads and log IDs only.
  - `INV-7` (Tokens & Design): Grep `#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms` finds 0 occurrences in `packages/configurator` outside `tokens.css`. Admin routes use Polaris web components with 0 custom CSS or color styles.
  - `INV-8` (Webhooks & Jobs): Webhooks enqueue jobs by ID and return 200 immediately; handlers are idempotent; duplicate job delivery verified in tests.
  - `INV-9` (Storefront Strings): Storefront configurator copy lives in `strings.ts` files; 0 raw JSX text literals in step components.
  - `INV-10` (Redaction Cleanup): `shop/redact` cascades across all Prisma models containing `shopId` (dynamically checked against Prisma DMMF) and cleans S3 `shops/<shopId>/` prefix.
- **2026-11-09** — Structural invariants verification (`ARCHITECTURE.md`):
  - Invariant 1: Routes call services; services never import `react-router`. Not holding: while grep confirms 0 imports of `react-router` in `*.service.server.ts`, grepping route files for direct database access (`rg 'db\.server|prisma' app/routes`) reveals that `app/routes/webhooks.app.scopes_update.tsx` directly imports `db from "../db.server"` and writes Prisma persistence (`db.session.update`) directly from the route handler instead of calling a service. Follow-up Spec 38 filed to move persistence behind a service.
  - Invariant 2: In production code, grep confirms `process.env` appears exclusively in `app/shared/config.server.ts`. (Test file `object-store.server.test.ts` has 15 hits addressed in Spec 36).
  - Invariant 3: Grep confirms `new PrismaClient`, `new S3Client`, `new Resend`, and `new PgBoss` are instantiated exclusively in `app/shared/container/` and all are lazy getters.
  - Invariant 4: `packages/rx-core/package.json` has only `zod` in `dependencies`.
  - Invariant 5: Every route in `routes/proxy.*` and `routes/webhooks.*` verifies signature at invocation start.
  - Invariant 6: Every endpoint is consumed by another spec or by the e2e flow table.
  - Invariant 7: Configurator makes network calls exclusively to `/apps/lens-advisor/*` and Shopify `/cart/*.js`.
- **2026-11-09** — Stubs and wiring verification (32 Wiring sections, R1-F4):
  - Evaluated all 32 `## Wiring` sections in specs 00–33 (Spec 00 and Spec 33 have no Wiring section):
    - Spec 01: Names stubbed `test:e2e` and unrouted proxy/webhook URLs. Evidence: `playwright test` runner implemented; all proxy routes (`app/routes/proxy.*`) and webhook routes (`app/routes/webhooks.*`) implemented.
    - Spec 02: Names no stubs. Real Prisma schema and `TEST_DATABASE_URL`.
    - Spec 03: Names no stubs. Real Zod schemas and TypeScript types in `packages/rx-core`.
    - Spec 04: Names empty `<lens-configurator>` element until spec 16; no theme block on live theme until spec 33. Evidence: custom element and loader assets implemented.
    - Spec 05: Names no stubs. Real AES-256-GCM cipher with AAD in `app/shared/crypto/`.
    - Spec 06: Names no production stubs (fake S3 client in tests only). Real S3 storage adapter in `app/shared/storage/`.
    - Spec 07: Names no production stubs (fake Resend client in tests only). Real Resend adapter in `app/shared/mail/`.
    - Spec 08: Names no stubs. Real pg-boss queue in `app/shared/queue/`.
    - Spec 09: Names no production stubs (fake admin client in tests only). Real plan gate in `app/features/billing/`.
    - Spec 10: Names no stubs. Real diopter parser and validation in `packages/rx-core/src/rx/`.
    - Spec 11: Names no stubs. Real Rx limits engine in `packages/rx-core/src/limits/`.
    - Spec 12: Names no stubs. Real lab code compiler in `packages/rx-core/src/lab-code/`.
    - Spec 13: Names no stubs. Real pricing engine in `packages/rx-core/src/pricing/`.
    - Spec 14: Names no production stubs. Real catalog repository and service in `app/features/catalog/`.
    - Spec 15: Names no production stubs. Real settings repository and service in `app/features/settings/`.
    - Spec 16: Names stubbed step folders until later specs (test fixtures used; production shell showed empty-catalog fallback). Evidence: all 7 step folders implemented in `packages/configurator/src/steps/`.
    - Spec 17: Names no production stubs (fake admin client in tests only). Real Shopify product sync in `app/features/product-sync/`.
    - Spec 18: Names no production stubs. Real admin lenses routes in `app/routes/app.lenses*`.
    - Spec 19: Names no production stubs. Real admin options routes in `app/routes/app.options*`.
    - Spec 20: Names no production stubs. Real admin settings route in `app/routes/app.settings.tsx`.
    - Spec 21: Names no production stubs. Real proxy catalog route in `app/routes/proxy.catalog.ts`.
    - Spec 22: Names no production stubs. Real prescription endpoints in `app/routes/proxy.prescriptions.ts` and `app/routes/proxy.upload-url.ts`.
    - Spec 23: Names stubbed `lab-orders.dispatch` handler until spec 30. Evidence: dispatch handler implemented in `app/features/lab-dispatch/jobs.server.ts`.
    - Spec 24: Names no stubs. Real PDF and CSV ticket renderers in `app/features/lab-orders/ticket/`.
    - Spec 25: Names no production stubs. Real compliance webhooks in `app/routes/webhooks.compliance.ts`.
    - Spec 26: Names no production stubs. Real Steps 1–2 implemented in `packages/configurator/src/steps/01-rx-type/` and `02-prescription/`.
    - Spec 27: Names no production stubs. Real Steps 3–4 implemented in `packages/configurator/src/steps/03-lens-group/` and `04-lens/`.
    - Spec 28: Names no production stubs. Real Steps 5–6 implemented in `packages/configurator/src/steps/05-options/` and `06-add-ons/`.
    - Spec 29: Names no production stubs. Real Step 7 implemented in `packages/configurator/src/steps/07-review/`.
    - Spec 30: Names no production stubs. Real lab order dispatch job and S3 upload in `app/features/lab-dispatch/`.
    - Spec 31: Names no production stubs. Real admin home setup checklist in `app/routes/app._index.tsx`.
    - Spec 32: Names no production stubs. Real lab orders admin routes in `app/routes/app.lab-orders*`.
  - Production code grep evidence:
    - Command: `rg -i '(stub|fake|mock|placeholder|not implemented|todo|fixme)' app/ packages/*/src/ --glob '!**/*.test.*' --glob '!**/*.spec.*' --glob '!**/fixtures/**' --glob '!**/test-helpers/**'`
    - Output:
      - `packages/configurator/src/cart/add-bundle.ts:98`: `// In environments like jsdom, navigation is not implemented`
      - `app/features/compliance/deps.server.ts:53`: `/** Tests inject the fake mailer, object store, and throwaway database. */`
      - `app/features/billing/plan.server.ts:9`: `* narrow lets unit tests pass a fake client without building a full auth context.`
    - Confirmed: 0 stubs, fakes, mocks, or placeholders in executable production code.
- **2026-11-09** — Design system token check:
  - Scanned all `--la-*` token references across `packages/configurator`.
  - Finding: `packages/configurator/src/steps/02-prescription/prescription.css:408` uses invalid token `--la-radius-full` instead of canonical `--la-radius-pill`. Done-when box 8 left unticked; follow-up Spec 35 filed.
- **2026-11-09** — CLI tooling check (Step 8):
  - Ran `pnpm exec shopify app deploy --dry-run`: Command "shopify" not found. `@shopify/cli` is not a dependency in `package.json`; per Hard Rule 7 (no machine-level installs), CLI execution is deferred to dev store runner.
- **2026-11-09** — Findings and follow-up specs filed (R2-F1, R2-F2, R2-F3, R2-F4, R2-F6):
  - Split findings into separate uniquely numbered follow-up specs (Specs 35–38), each with the full template and a Log:
    - Spec 35 (`specs/35-tokens-css.md`): Replace invalid token `--la-radius-full` with `--la-radius-pill` in `packages/configurator/src/steps/02-prescription/prescription.css:408`.
    - Spec 36 (`specs/36-storage-test-env.md`): Replace direct `process.env` mutations with `vi.stubEnv` in `app/shared/storage/object-store.server.test.ts:577-608` (15 hits violating Spec 01 gate).
    - Spec 37 (`specs/37-lab-order-tenancy.md`): Require `{ shopId, labOrderId }` in job payload and scope `getLabOrderShopId` by `{ id, shopId }` with two-shop isolation tests in `app/features/lab-dispatch/` (INV-1, R3-F2).
    - Spec 38 (`specs/38-webhook-hardening.md`): Add Zod schema validation to `webhooks.app.scopes_update.tsx` and `webhooks.products.update.tsx` (log IDs only) (INV-6), and decouple `webhooks.app.scopes_update.tsx` from direct `db.server` persistence (Structural Invariant 1).
  - Updated `specs/README.md` spec list, wave count (11 waves), critical path, and dependency table.
- **2026-11-08** — Evidence (orchestro spec verify, tree 77f8304d): install pass · typecheck pass · lint pass · build pass · test pass 1307/0/0
