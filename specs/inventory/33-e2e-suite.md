# Inventory fragment — Spec 33 (End-to-end suite)

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
### `e2e-storage-mail-mock`
`e2e/helpers/storage-mail-mock.ts` — `createMockObjectStore`, `createMockMailer`, `setupStorageAndMailerMocks`, `teardownStorageAndMailerMocks`. In-memory storage and mailer adapters capturing ticket uploads and notification dispatches.
**Use instead of:** live S3 or Resend API calls during server e2e flows.
**Added by:** spec 33.
### `e2e-seed-helpers`
`e2e/helpers/seed.ts` — `seedShop`, `seedLensGroup`, `seedLens`, `seedOptionGroup`, `seedAddOn`, `seedSettings`. Seed helpers invoking service layers (specs 14, 15, 17) rather than direct SQL.
**Use instead of:** raw SQL seeding in end-to-end suites.
**Added by:** spec 33.
### `e2e-cart-url`
`e2e/helpers/cart-url.ts` — `buildCartUrl(pageUrlOrOrigin, path)`. Resolves absolute cart URLs against the current page URL or base URL for Playwright storefront request contexts.
**Use instead of:** hardcoded relative endpoints in `page.request` calls.
**Added by:** spec 33.
### `e2e-queue-mock`
`e2e/helpers/queue-mock.ts` — `createMockQueue()`, `setupQueueMock()`, `teardownQueueMock()`. Queue seam adapter capturing enqueued jobs across Node and Vite module runtimes while routing them to pg-boss in a run-scoped schema on the test database. Filters out deduped singletons returning null (R5-F1).
**Use instead of:** live pg-boss worker polling during server e2e tests.
**Added by:** spec 33.
### `e2e-standalone-number`
`e2e/helpers/standalone-number.ts` — `standaloneNumber(value)`. Regex builder matching numbers unless bordered by letters, digits, or dots, preserving clinical unit-suffixed matches while rejecting cuid IDs and ISO timestamps.
**Use instead of:** raw substring checks for clinical values in privacy assertions.
**Added by:** spec 33.
### `e2e-vite-loader`
`e2e/helpers/vite.ts` — `getViteServer()`, `loadServerModule(path)`, and `closeViteServer()`. In-process custom Vite dev server runner for loading server modules with `import.meta.glob` support during e2e tests.
**Use instead of:** executing Vite-dependent route modules in plain Node.
**Added by:** spec 33.
