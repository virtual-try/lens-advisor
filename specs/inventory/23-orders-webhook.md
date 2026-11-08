# Inventory fragment — Spec 23 (orders/create webhook → lab orders)

### `lab-orders-constants`
`app/features/lab-orders/constants.ts` — Leaf module exporting job name constants, schemas, and Shopify GID conversion helpers without pulling Prisma, cipher, or service dependencies into the webhook route (R2-F11):
- `INTAKE_JOB_NAME = "lab-orders.intake"`: Queue name constant for the intake job.
- `DISPATCH_JOB_NAME = "lab-orders.dispatch"`: Queue name constant for the lab order dispatch job.
- `dispatchJobPayloadSchema`: Zod schema for dispatch payload `{ labOrderId: string }`.
- `toOrderGid(id)` / `fromOrderGid(gidOrId)`: Pure string conversion helpers between numeric order ID and `gid://shopify/Order/<id>`.
**Use instead of:** Importing domain services or Prisma into route handlers.
**Added by:** spec 23.

### `orders-create-webhook-route`
`app/routes/webhooks.orders.create.ts` — Webhook action endpoint `POST /webhooks/orders/create`. Authenticates webhook HMAC signature (`authenticate.webhook`, INV-6; invalid signature returns standard 401 JSON shape, non-Response errors rethrown, R2-F7). Strictly validates webhook payload with Zod (`orderWebhookPayloadSchema`, R1-F4, R2-F8; requires positive integer or numeric string id, or numeric gid suffix; empty-suffix gid and non-numeric ids return 400 MALFORMED_PAYLOAD with no enqueue and log error code only, INV-2). Performs zero DB and zero Admin API queries inside the request (INV-8, Self-check 1). Extracts order ID from payload (`payload.id` or `payload.admin_graphql_api_id`), enqueues `lab-orders.intake` job with `{ shopDomain, shopifyOrderId }` only and `singletonKey = shopifyOrderId` (INV-2, INV-8, R2-F9), and returns HTTP 200 immediately.
- **Payload stored in job:** Only `{ shopDomain, shopifyOrderId }`. Full order payload is not persisted to queue (INV-2, INV-8, R2-F9).
- **Architecture:** Route authenticates, validates payload with Zod, and enqueues only. All DB and Admin GraphQL operations run in background jobs.
**Use instead of:** Running order parsing, DB upserts, or Admin API queries synchronously inside Shopify webhook handlers.
**Added by:** spec 23.

### `lab-orders-repository`
`app/features/lab-orders/lab-orders.repository.server.ts` — Shop-scoped Prisma data access functions for the `LabOrder` model:
- `upsertLabOrder(db, shopId, input)`: Upserts a `LabOrder` using a single atomic statement on the unique key `@@unique([shopId, shopifyOrderId, bundleId])` (INV-1, Self-check 2). Supports nullable `lensId` when a lens is not found or deleted (R2-F1). On conflict, terminal and workflow-owned fields (`status`, `lastErrorCode`, `attempts`, `ticketKeys`, `providerId`, `sentAt`) are preserved (R1-F3). Concurrent duplicate calls cannot produce duplicate rows.
- `getLabOrderById(db, shopId, id)`: Fetches a lab order by ID scoped strictly to `shopId` (INV-1).
- `getLabOrderByShopifyOrderAndBundle(db, shopId, shopifyOrderId, bundleId)`: Look up lab order by Shopify order ID and bundle ID scoped to `shopId` (INV-1).
- `listLabOrdersByShop(db, shopId)`: Lists all lab orders for a given shop scoped to `shopId` (INV-1).
**Use instead of:** Raw Prisma queries on `LabOrder` or unscoped order mutations.
**Added by:** spec 23.

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
