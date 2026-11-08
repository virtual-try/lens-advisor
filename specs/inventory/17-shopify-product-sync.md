# Inventory fragment — Spec 17 (Shopify product sync for lenses, options and add-ons)

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

### `archive-item`
`app/features/product-sync/product-sync.server.ts` (re-exported from `app/features/product-sync/index.ts`) — `archiveItem(admin, shopId, entity, id, deps?)` sets the corresponding Shopify product status to `DRAFT` when a catalog row is archived or disabled.
- Reads the entity via `catalogService` scoped to `shopId` (INV-1).
- Looks up the product ID from stored `shopifyProductId` or queries the parent product from `shopifyVariantId` (`GetVariantProduct`).
- If never synced, returns `{ ok: true, archived: false, reason: "NOT_SYNCED" }`.
- Executes `productUpdate` with status `DRAFT`, throwing `SyncError` on failure.
**Use instead of:** manual Shopify product drafting or deleting products on archive.
**Added by:** spec 17.

### `sync-error`
`app/features/product-sync/errors.ts` (re-exported from `app/features/product-sync/index.ts`) — `SyncError` extends `AppError` (HTTP status 400). Error codes: `SYNC_FAILED`, `CURRENCY_MISMATCH`, `GRAPHQL_ERROR`, `ORPHAN_PRODUCT`.
**Use instead of:** generic Error or unhandled exceptions when communicating with Shopify GraphQL APIs.
**Added by:** spec 17.
