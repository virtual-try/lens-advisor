# Inventory fragment — Spec 33 (End-to-end suite)

### `e2e-shared-db`
`e2e/helpers/shared-db.ts` — `getSharedTestDb()` and `teardownSharedTestDb()`. Creates a single migrated PostgreSQL schema on `TEST_DATABASE_URL` shared across the in-process server test run so Shopify PrismaSessionStorage references stay valid across sequential spec files.
**Use instead of:** recreating separate schemas per test file in Playwright test suites.
**Added by:** spec 33.

### `e2e-shopify-auth-fixtures`
`e2e/helpers/shopify-auth.ts` — `createSessionToken`, `createAuthHeaders`, `createAdminUrl`, `createSignedProxyRequest`, `createSignedWebhookRequest`, `createLoaderArgs`, `createActionArgs`, and `unwrapData`. Signed request builders for Shopify admin requests, proxy signatures, and webhook HMAC verification conforming to INV-6.
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
