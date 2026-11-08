# Spec 33 — End-to-end suite

**Status:** Not started
**Depends on:** Spec 18, Spec 19, Spec 20, Spec 21, Spec 22, Spec 25, Spec 26, Spec 27, Spec 29, Spec 31, Spec 32
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `playwright.config.ts`, `e2e/`, `specs/inventory/33-e2e-suite.md`
**Reuses:** `ARCHITECTURE.md#test-data`, `test/db.ts` (spec 02), `AGENT-GUIDE.md`

## Goal

The only spec that writes or runs end-to-end tests. Install Playwright, write one test file per flow area
covering every row of the flow table, and get the suite green against the running app and a Shopify dev
store — so the integrated paths are proven once, after every implementation spec has merged.

## Scope

- Install Playwright (chromium only), `playwright.config.ts` with trace + screenshot on failure; add the
  `test:e2e` script named in `AGENT-GUIDE.md`.
- Two projects (spec 00 Testing):
  - **storefront** — a password-protected dev store with the app installed, the app block on the product
    template and the app tunnel/URL running; `E2E_STORE_URL`, `E2E_STORE_PASSWORD` from env.
  - **server** — admin loaders/actions and webhooks called in-process with `testConfig()` and signed
    fixtures (no automated Shopify Admin login), on the test DB.
- Seed through the services (14, 15, 17), never SQL. Each test seeds its own shop data and runs alone.
- Role- and text-based locators inside the Shadow DOM (Playwright pierces open shadow roots); web-first
  assertions; no sleeps.

### Flow table — the coverage contract

| Flow | Built by | Proves |
| --- | --- | --- |
| Shop with no plan opens the admin | 09 | redirect to plan selection |
| Create group + lens with limits, save | 18, 17 | lens listed, sync badge Synced, variant id stored |
| Create option group with a priced value and an add-on | 19, 17 | priced value gets a variant; zero-price does not |
| Save settings with two lab emails, invalid email rejected | 20 | values persist after reload; error shown |
| Admin home checklist ticks after the above | 31 | both items ticked |
| Storefront: product page → Select lenses → SV → manual Rx → lens → options → add-ons → review → Add to cart | 26, 27, 28, 29, 21, 22 | cart has the frame with nested lens/option/add-on lines; total equals review total |
| Storefront: Rx beyond a lens's SPH limit | 27 | that lens is disabled with its reason |
| Storefront: upload path with a PNG | 26, 22 | rxRef stored; review says "Prescription on file" |
| Storefront: cart properties with `storeRxInOrder` off | 29 | no Rx value in the cart JSON (`/cart.js`) |
| Proxy call with a bad signature | 21, 22 | 401 |
| orders/create webhook for a fixture order | 23, 30 | LabOrder SENT with the fake mailer; ticket key in the store |
| Lab orders list → Resend | 32 | job enqueued; status back to Pending |
| Compliance `shop/redact` | 25 | shop rows and S3 prefix gone |

## Explicit non-scope

- Fixing application code → each app bug becomes a new fix spec numbered after spec 34, appended to
  `README.md` and `PROGRESS.md`; this spec's Log names it and the test stays `fixme` with that number.
- Unit tests — each spec owns its own. Clean-install verification → spec 34.

## Reuse first

- Fixtures and fakes recorded in `specs/inventory/` (signed webhook/proxy request builders from 01/21,
  the in-memory mailer and object store from 06/07). Do not build a second seeding path.

## Steps

1. Install Playwright + chromium; configure both projects.
2. One trivial test per project (server: health loader; storefront: product page loads); get them green.
3. One file per flow area under `e2e/`, every flow-table row covered.
4. Run headless; triage each failure as test bug (fix) or app bug (fix spec + `fixme`).
5. Record fix specs in the Log; counts from the runner's own summary line.

## Done when

- [x] `pnpm test:e2e --project=server` passes headless with 0 failures (excluding `fixme` tests naming a fix spec). [e2e]
- [ ] `pnpm test:e2e --project=storefront` passes headless with 0 failures. [requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL]
- [x] Every row of the flow table has at least one test, named in the Log. [static]
- [x] Every app bug found has a numbered fix spec in `README.md` and `PROGRESS.md`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Installed `@playwright/test` and configured `playwright.config.ts` with `server` and `storefront` projects, `screenshot: "only-on-failure"`, and `trace: "retain-on-failure"`. Added `"test:e2e": "playwright test"` to `package.json` and updated `tsconfig.json`.
- **Flow Table Test Coverage**:
  - *Shop with no plan opens the admin*: `e2e/server/admin-plan.spec.ts` (`Flow 1: Shop with no plan opens admin -> redirect to plan selection`)
  - *Create group + lens with limits, save*: `e2e/server/admin-lenses.spec.ts` (`Flow 2: Create group + lens with limits, save -> lens listed, sync badge Synced, variant id stored`)
  - *Create option group with a priced value and an add-on*: `e2e/server/admin-options.spec.ts` (`Flow 3: Create option group with a priced value and an add-on -> priced value gets a variant; zero-price does not`)
  - *Save settings with two lab emails, invalid email rejected*: `e2e/server/admin-settings.spec.ts` (`Flow 4: Save settings with two lab emails, invalid email rejected -> values persist after reload; error shown`)
  - *Admin home checklist ticks after the above*: `e2e/server/admin-home.spec.ts` (`Flow 5: Checklist ticks after lens + lab email -> both ticked shows complete`)
  - *Storefront: product page → Select lenses → SV → manual Rx → lens → options → add-ons → review → Add to cart*: `e2e/storefront/configurator.spec.ts` (`Flow 6: product page -> Select lenses -> SV -> manual Rx -> lens -> options -> add-ons -> review -> Add to cart`)
  - *Storefront: Rx beyond a lens's SPH limit*: `e2e/storefront/configurator.spec.ts` (`Flow 7: Rx beyond a lens's SPH limit -> that lens is disabled with its reason`)
  - *Storefront: upload path with a PNG*: `e2e/storefront/configurator.spec.ts` (`Flow 8: upload path with a PNG -> rxRef stored; review says 'Prescription on file'`)
  - *Storefront: cart properties with storeRxInOrder off*: `e2e/storefront/configurator.spec.ts` (`Flow 9: cart properties with storeRxInOrder off -> no Rx value in the cart JSON (/cart.js)`)
  - *Proxy call with a bad signature*: `e2e/server/proxy.spec.ts` (`Flow 10: Proxy call with bad signature (catalog or prescriptions) returns 401 Unauthorized`)
  - *orders/create webhook for a fixture order*: `e2e/server/orders.spec.ts` (`Flow 11: Webhook orders/create intake -> lab order dispatch (PDF ticket uploaded, mail sent, status SENT)`)
  - *Lab orders list → Resend*: `e2e/server/orders.spec.ts` (`Flow 12: Resend failed lab order -> resets to PENDING, transitions to SENT with timestamp`)
  - *Compliance shop/redact*: `e2e/server/compliance.spec.ts` (`Flow 13: Compliance shop/redact -> shop rows and S3 prefix gone`)
- **Triage & App Bugs**:
  - Test bug fixed: Isolated `Session` table drops across test files by creating `e2e/helpers/shared-db.ts` to retain the migrated schema reference across sequential in-process server runs.
  - Test bug fixed: Fixed `LabOrder` creation and assertion fields from non-existent `retryCount` and `emailSentAt` to schema fields `attempts` and `sentAt`.
  - App bug triaged: `app/shared/queue/web-definitions.server.ts` unconditionally calls `import.meta.glob`, which throws `TypeError: (intermediate value).glob is not a function` outside Vite bundler execution when routes invoke `getQueue()`. Per binding non-scope rules, app code was not edited; tests in `e2e/server/orders.spec.ts` are marked `fixme`, and fix spec 35 (`specs/35-fix-web-feature-jobs-glob.md`) was created and appended to `specs/README.md` and `specs/PROGRESS.md`.
- **Runner Summaries**:
  - `pnpm test:e2e --project=server`: `2 skipped, 9 passed (1.7s)`
  - `pnpm test:e2e --project=storefront`: `5 skipped (0.8s)` (requires live Shopify dev store; env missing)
  - `pnpm test:e2e`: `7 skipped, 9 passed (2.4s)`
  - `pnpm typecheck`: `✔ Generated Prisma Client ... Done in 1.3s` (0 errors)
  - `pnpm lint`: `eslint . --max-warnings 0` (0 errors, 0 warnings)
  - `pnpm build`: `build/client ... build/server/index.js 523.30 kB ... Done in 745ms` (0 errors)
  - `pnpm test`: `Test Files 72 passed (72), Tests 1307 passed (1307), Duration 14.28s`
- **Inventory Fragment**: `specs/inventory/33-e2e-suite.md` recorded for `e2e-shared-db`, `e2e-shopify-auth-fixtures`, `e2e-shopify-mock`, `e2e-storage-mail-mock`, and `e2e-seed-helpers`.
- **2026-11-08** — Evidence (orchestro spec verify, tree 822bad46): install pass · typecheck pass · lint pass · build pass · test pass 1307/0/0
- **2026-11-08** — Review round R1 fixes applied by coder agy-3:
  - R1-F1: Added Spec 35 row to `specs/PROGRESS.md`, updated spec count to 36 (00–35), and recorded log entry.
  - R1-F2: Formatted `specs/35-fix-web-feature-jobs-glob.md` with full template (Explicit non-scope, Steps, Log), typed glob check (`typeof (import.meta as { glob?: unknown }).glob === "function"`), and explicit non-Vite fallback definition list.
  - R1-F3: Widened spec 35 Scope to include queue test seam and `TEST_DATABASE_URL` guarantee. Maintained `fixme` on Flows 11 & 12 in `e2e/server/orders.spec.ts` naming spec 35.
  - R1-F4: Derived all storefront locators in `e2e/storefront/configurator.spec.ts` from real step markup in `packages/configurator/src`.
  - R1-F5: Storefront tests updated: Flow 6 selects option and add-on, asserts nested lines and total equality; Flow 8 uploads real tiny PNG fixture without `isVisible` guard and asserts `rxRef`; Flow 9 explicitly enforces `storeRxInOrder: false` and asserts cart JSON properties; removed loops and networkidle in favor of web-first assertions.
  - R1-F6: Registered `globalTeardown: "./e2e/helpers/global-teardown.ts"` in `playwright.config.ts` and updated `e2e/helpers/shared-db.ts` to drop schema both in-memory and via schema tracking file so test schemas are never leaked.
  - R1-F7: Deleted `test-results/.last-run.json` and added `/test-results/` and `/playwright-report/` to `.gitignore`.
  - R1-F8: Updated `e2e/helpers/shopify-mock.ts` to throw an Error on unmatched GraphQL queries; removed mock import from `playwright.config.ts`; added `e2e/server/shopify-mock.spec.ts` testing that unmatched queries throw.
  - R1-F9: Updated `e2e/server/compliance.spec.ts` (Flow 13) to assert `shopSettings` is deleted and iterate Prisma DMMF models with `shopId` to assert all are empty.
  - R1-F10: In `e2e/server/admin-lenses.spec.ts`, replaced `toBeDefined()` on Prisma `findFirst` with `not.toBeNull()`, and asserted sync status fields the badge reads (`isFailed === false`, `isSynced === true`).
