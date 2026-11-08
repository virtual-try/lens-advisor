# Inventory fragment — Spec 23 (orders/create webhook → lab orders)

### `orders-create-webhook-route`
`app/routes/webhooks.orders.create.ts` — Webhook action endpoint `POST /webhooks/orders/create`. Authenticates webhook HMAC signature (`authenticate.webhook`, INV-6). Performs zero DB and zero Admin API queries inside the request (INV-8, Self-check 1). Extracts order ID from payload (`payload.id` or `payload.admin_graphql_api_id`), enqueues `lab-orders.intake` job with `{ shopId, shopifyOrderId }` only and `singletonKey = shopifyOrderId` (INV-2, INV-8), and returns HTTP 200 immediately.
- **Payload stored in job:** Only `{ shopId, shopifyOrderId }`. Full order payload is not persisted to queue (INV-2, INV-8).
- **Architecture:** Route authenticates and enqueues only. All DB and Admin GraphQL operations run in background jobs.
**Use instead of:** Running order parsing, DB upserts, or Admin API queries synchronously inside Shopify webhook handlers.
**Added by:** spec 23.

### `lab-orders-repository`
`app/features/lab-orders/lab-orders.repository.server.ts` — Shop-scoped Prisma data access functions for the `LabOrder` model:
- `upsertLabOrder(db, shopId, input)`: Upserts a `LabOrder` using a single atomic statement on the unique key `@@unique([shopId, shopifyOrderId, bundleId])` (INV-1, Self-check 2). Concurrent duplicate calls cannot produce duplicate rows.
- `getLabOrderById(db, shopId, id)`: Fetches a lab order by ID scoped strictly to `shopId` (INV-1).
- `getLabOrderByShopifyOrderAndBundle(db, shopId, shopifyOrderId, bundleId)`: Look up lab order by Shopify order ID and bundle ID scoped to `shopId` (INV-1).
- `listLabOrdersByShop(db, shopId)`: Lists all lab orders for a given shop scoped to `shopId` (INV-1).
**Use instead of:** Raw Prisma queries on `LabOrder` or unscoped order mutations.
**Added by:** spec 23.

### `lab-orders-intake-service`
`app/features/lab-orders/intake.service.server.ts` — Domain service (`IntakeService`, `createIntakeService`) orchestrating order intake:
- `processOrderIntake(shopIdOrDomain, shopifyOrderId)`: Resolves shop tenancy, queries order via Admin GraphQL (`ORDER_INTAKE_QUERY`), groups line items by `_bundle_id`, parses lens bundle properties using `readBundleProperties` (spec 03), reads frame title and SKU from the parent/frame line, checks prescription existence and tenant isolation (`getPrescriptionById`), links prescription to order (`attachOrder`), decrypts manual Rx in local memory to evaluate `checkLens` (spec 11) without storing decrypted Rx on `LabOrder` (INV-2, Self-check 3), upserts `LabOrder` rows, and enqueues `lab-orders.dispatch` jobs with `{ labOrderId }` and `singletonKey = labOrderId`.
- Orders with unknown or cross-shop `_rx_ref` create a `LabOrder` with `prescriptionId = null`, `status = FAILED`, `lastErrorCode = RX_NOT_FOUND`, and trigger no dispatch job.
- Orders without bundle lines create no rows and complete immediately.
- Helpers: `toOrderGid`, `fromOrderGid`, `extractAttributesRecord`, `ORDER_INTAKE_QUERY`.
**Use instead of:** Ad-hoc order parsing or mixing GraphQL fetches and limits checking in route actions or queue workers.
**Added by:** spec 23.

### `lab-orders-jobs`
`app/features/lab-orders/jobs.server.ts` — Background job definitions conforming to spec 08 queue contract:
- `INTAKE_JOB_NAME = "lab-orders.intake"` (`intakeJob`): Payload `{ shopId: string, shopifyOrderId: string }` validated by `intakeJobPayloadSchema`.
- `DISPATCH_JOB_NAME = "lab-orders.dispatch"` (`dispatchJob`): Payload `{ labOrderId: string }` validated by `dispatchJobPayloadSchema`. Handler stubbed until spec 30.
- Payload schemas strictly satisfy INV-2 (payloads carry only ids/enums, field names match `*Id`).
**Use instead of:** Raw `pg-boss` queues or unvalidated job payloads.
**Added by:** spec 23.
