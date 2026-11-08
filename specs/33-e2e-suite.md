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
  - Harness execution resolved: Initial triage misattributed plain-Node harness failure on `import.meta.glob` in `app/shared/queue/web-definitions.server.ts` as an application bug (drafting spec 35). Resolving test execution via the in-process Vite runner (`e2e/helpers/vite.ts`) confirmed no application defect exists: native `import.meta.glob` functions as intended in Vite, draft spec 35 was deleted, and tests run cleanly without `fixme`.
- **Runner Summaries**:
  - `pnpm test:e2e --project=server`: `25 passed (3.1s)` (0 skipped, 0 failed)
  - `pnpm test:e2e --project=storefront`: `5 skipped (0.9s)` (requires live Shopify dev store; env missing)
  - Gates (typecheck, lint, build, test): verified by tree-stamped `orchestro spec verify` evidence lines below.
- **Inventory Fragment**: `specs/inventory/33-e2e-suite.md` recorded for `e2e-shared-db`, `e2e-shopify-auth-fixtures`, `e2e-shopify-mock`, `e2e-storage-mail-mock`, `e2e-seed-helpers`, `e2e-cart-url`, and `e2e-queue-mock`.
- **2026-11-08** — Evidence (orchestro spec verify, tree b2f46180): install pass · typecheck pass · lint pass · build pass · test pass 1307/0/0
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
- **2026-11-08** — Review round R2 fixes applied by coder agy-3:
  - R2-F1: Re-ran `pnpm test:e2e --project=server` at HEAD and recorded exact summary counts: 3 skipped, 10 passed (1.7s).
  - R2-F3: Configured `use.baseURL` for storefront project from `process.env.E2E_STORE_URL` in `playwright.config.ts`, created `e2e/helpers/cart-url.ts` with `buildCartUrl`, tested in `test/cart-url.test.ts` (5 passed), and routed `/cart.js` calls in Flows 6, 8, and 9 through `buildCartUrl(page.url())`.
  - R2-F4: Rewrote Flow 11 in `e2e/server/orders.spec.ts` to capture the queued intake job via queue test seam (`e2e/helpers/queue-mock.ts`), run it through real `intakeJob.handler`, capture the resulting dispatch job, and run it through real `dispatchJob.handler` with zero manual intake/dispatch service calls. Kept `fixme` naming spec 35. Added Done-when checkbox in spec 35.
  - R2-F5: Rewrote Flow 12 in `e2e/server/orders.spec.ts` to exercise the full list-to-detail path (`labOrdersListLoader` and `labOrderDetailLoader`), trigger resend via `labOrderDetailAction`, assert exactly one dispatch job captured via the queue seam, and run that captured job through `dispatchJob.handler` with no manual handler calls. Kept `fixme` naming spec 35.
  - R2-F6: Split Flow 13 in `e2e/server/compliance.spec.ts`: Test 1 (live) seeds shop B with DB rows and S3 objects and asserts shop B is untouched after shop A's redaction. Added Test 2 (fixme naming spec 35) which sends a signed `shop/redact` through `/webhooks/compliance`, captures the queued job, and executes `shopRedactJob.handler`.
  - R2-F7: In Flow 9 of `e2e/storefront/configurator.spec.ts`, strictly asserted the exact allowed set of `_`-prefixed property keys (`_bundle_id`, `_bundle_role`, `_item_id`, `_option_ids`, `_addon_ids`, `_rx_ref`, `_parent_id`), asserted that `_rx_od`, `_rx_os`, `_rx_pd` are undefined, and scanned every property value across all items for normalized Rx forms (`-2.50`, `-2.5`, `2.50`, `-250`, `63.0`, standalone `63`, `PD 63`).
  - R2-F8: In `e2e/storefront/health.spec.ts`, updated password form authentication to use web-first assertion `expect(passwordInput).not.toBeVisible()`, and required both a product-specific element and the Select lenses control to be visible.
  - R2-F10: Staged removal of tracked `test-results/.last-run.json` (`git rm --cached test-results/.last-run.json`), removed local artifact directory, and verified `git ls-files test-results` is empty.
- **2026-11-09** — Review round R3 fixes applied by coder agy-3:
  - R3-F1: Flow-table coverage proven at the loader/action data level for Flows 2, 4, and 5:
    - Flow 2 (`e2e/server/admin-lenses.spec.ts`): asserted sync status field `shopifyVariantId` is truthy and matches `^gid:\/\/shopify\/ProductVariant\/\d+$` and `syncFailedId` is null (the exact conditions rendering `<s-badge tone="success">Synced</s-badge>` via `isSynced = Boolean(shopifyVariantId) && !isFailed`).
    - Flow 4 (`e2e/server/admin-settings.spec.ts`): asserted the exact action field error: `error.code === "EMAIL"`, `error.fields === [{ path: "labEmail.0", code: "EMAIL" }]`, and message `"Enter a valid lab email address."`.
    - Flow 5 (`e2e/server/admin-home.spec.ts`): asserted checklist items' done flags after reload: `hasLens === true` and `hasLabEmail === true` (and `hasLens && hasLabEmail === true`, rendering the checklist item `✓ Done` badges and the "You're live" banner).
  - R3-F2: In Flow 9 of `e2e/storefront/configurator.spec.ts`, allowlisted every cart property key (not just `_`-prefixed ones: `_bundle_id`, `_bundle_role`, `_item_id`, `_option_ids`, `_addon_ids`, `_rx_ref`, `_parent_id`, `Prescription`), and scanned both property keys and values for display and internal-unit representations (`-2.50`, `-2.5`, `-250`, `63`, `63.0`, `630`) and clinical terminology (`sphere`, `cylinder`, `axis`).
  - R3-F3: In `e2e/helpers/seed.ts` and `e2e/helpers/shopify-auth.ts`, wired `testConfig()` with test session storage (`shopifyTestConfig.sessionStorage.storeSession(...)`) and dummy credentials (`testApiSecretKey`, `testApiKey`), ensuring the server harness executes when only `TEST_DATABASE_URL` is set without real Shopify environment variables. Added passing test in `e2e/server/shopify-mock.spec.ts`.
  - R3-F4: In `e2e/helpers/shared-db.ts`, added `resetSharedTestDb()` deleting all shop-owned rows and sessions via Prisma in foreign-key order (`ComplianceRequest`, `LabOrder`, `Prescription`, `AddOn`, `OptionValue`, `OptionGroup`, `Lens`, `LensGroup`, `ShopSettings`, `Shop`, `Session`). Added `test.beforeEach` in every server test file to guarantee per-test isolation and added assertions verifying initial shop count is 0.
  - R3-F5: In `specs/35-fix-web-feature-jobs-glob.md`, updated Scope, Steps, and Done when to include un-annotating the compliance `shop/redact` webhook test at `e2e/server/compliance.spec.ts:151` from `test.fixme` and verifying it passes.
  - R3-F6: Deleted `test/cart-url.test.ts` to respect unit test boundaries and lead new-file limit; moved helper tests to `e2e/helpers/cart-url.spec.ts` in the server project. Restored vitest count to 72 files and 1307 tests.
- **2026-11-09** — Lead: the test gate was red on a flaky spec 32 test (INV-2 asserted the loader JSON lacks "90"/"2.25"; random cuid ids and ISO timestamps can contain those digits). The lead made its numeric checks match standalone numbers only (axis now 137, JSON -1.5 form added) in `app/features/lab-orders-admin/admin-lab-orders.test.tsx`. This is out of spec 33 scope but blocked its gate; the lead owns it. Verified with 5/5 runs of that file and a full gate run of 1307 tests.
- **2026-11-09** — Lead (R4-F1): tightened `standaloneNumber`. It now rejects only a letter, digit or dot before the number and a digit or decimal part after it. Checked cases: "SPH -2.25D" matches -2.25; "axis 137°" matches 137; `{"sph":-2.25}` and `"cyl":-1.5` match; "...12.250Z", "cmw8137i1006", "id9012" and "1370" do not.
- **2026-11-09** — Review round R4 fixes applied by coder agy-3:
  - R4-F1: Extracted `standaloneNumber` helper to `e2e/helpers/standalone-number.ts` and reused it in `app/features/lab-orders-admin/admin-lab-orders.test.tsx` and `e2e/storefront/configurator.spec.ts`. Added test suite in `e2e/helpers/standalone-number.spec.ts` verifying unit-suffixed Rx clinical values (`-2.25D`, `137°`, `63.0`) match while cuid IDs and timestamps do not.
  - R4-F2: Created in-process Vite runner in `e2e/helpers/vite.ts` (`loadServerModule`, `closeViteServer`) to execute Vite-dependent route modules and feature jobs with native `import.meta.glob` support. Pointed `DATABASE_URL` at `TEST_DATABASE_URL` across harness processes and updated `setupQueueMock` to intercept enqueues across Node and Vite runtimes while writing to real pg-boss on test DB. Un-fixme'd Flow 11, Flow 12 in `e2e/server/orders.spec.ts` and signed `shop/redact` test in `e2e/server/compliance.spec.ts`. Deleted `specs/35-fix-web-feature-jobs-glob.md` and reverted spec 35 rows in `specs/README.md`.
  - R4-F3: In Flow 3 (`e2e/server/admin-options.spec.ts`), created option group via `optionsIndexAction` with `intent: "create_group"`, asserting `{ ok: true, group }` and using returned group for subsequent priced value and add-on steps.
  - R4-F4: In Flows 6, 8, and 9 of `e2e/storefront/configurator.spec.ts`, replaced immediate `/cart.js` queries after Add to cart with `expect.poll` on `/cart.js` until expected line items appear (no fixed waits).
  - R4-F5: In Flow 9 of `e2e/storefront/configurator.spec.ts`, replaced raw substring checks on property values with `standaloneNumber` helper scanning, preventing false positives on opaque IDs while detecting clinical Rx values.
  - R4-F6: In `e2e/helpers/shared-db.ts`, replaced global schema tracking file with run-unique file `lens-advisor-e2e-schema-${runId}.txt` (configured via `process.env.E2E_RUN_ID` in `playwright.config.ts`), dropped only owned schema, and unlinked in `globalTeardown`.
  - R4-F7: Removed extra terminal blank lines in `.gitignore`, `e2e/helpers/shopify-auth.ts`, and `e2e/helpers/shopify-mock.ts`. Verified `git diff --check origin/main` is clean.
- **2026-11-09** — Review round R5 fixes applied by coder agy-3:
  - R5-F1: Updated `e2e/helpers/queue-mock.ts` so `NodeQueue.prototype.enqueue` and `viteQueueModule.Queue.prototype.enqueue` capture jobs into `mockQueue.jobs` only when the real `enqueue` returns a non-null job ID (deduped singleton enqueues returning `null` are omitted from capture). Configured run-scoped pg-boss schema `pgboss_e2e_<runId>` via `process.env.PGBOSS_SCHEMA` in `playwright.config.ts`, created in `e2e/helpers/global-setup.ts`, loaded via Vite plugin in `e2e/helpers/vite.ts`, and dropped with CASCADE in `e2e/helpers/global-teardown.ts` (with temp tracking file). Added behavior tests in `e2e/helpers/queue-mock.spec.ts` asserting non-null capture, null dedupe rejection, and run-scoped schema name.
  - R5-F2: Executed the server e2e suite at HEAD; verified exact summary: 25 passed, 0 skipped, 0 failed (3.1s). Recorded runner summary in Log.
  - R5-F3: Struck stale manual gate claims (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`) from Runner Summaries; all gate claims now reference tree-stamped `orchestro spec verify` evidence lines.
  - R5-F4: Staged deletion of `specs/35-fix-web-feature-jobs-glob.md` confirmed (deleted on disk and from `specs/README.md`). Corrected line 95 triage log and related text to clarify that the glob issue was plain-Node execution in the harness rather than an application bug.
