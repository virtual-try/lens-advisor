# Inventory fragment — Spec 06 (S3 storage adapter)

### `object-store`
`app/shared/storage/object-store.server.ts` — Factory `createObjectStore({ client, bucket, kmsKeyId })` producing an `ObjectStore` adapter that enforces server-side encryption (SSE-KMS) on all uploads, short-lived presigned download URLs, head-object queries, and safe shop-scoped paginated prefix deletions.
**Use instead of:** Instantiating AWS S3 clients directly in feature code or issuing presigned URLs without KMS encryption.
**Added by:** spec 06.

### `key-builders`
`app/shared/storage/object-store.server.ts` — Standardized S3 object key and prefix builders (`buildRxKey`, `buildTicketKey`, `buildShopPrefix`, `buildRxPrefix`, `buildTicketPrefix`) enforcing canonical storage layout (`shops/<shopId>/rx/<prescriptionId>/<uuid>.<ext>` and `shops/<shopId>/tickets/<labOrderId>.<pdf|csv>`) and path-traversal rejection (`/`, `..`, null bytes).
**Use instead of:** String-concatenating manual S3 keys or inventing non-standard storage paths.
**Added by:** spec 06.

### `object-store-container`
`app/shared/container/object-store.server.ts` — Composition root lazy singleton getter `getObjectStore()` providing the shared S3 `ObjectStore` instance configured from `config.server.ts`.
**Use instead of:** Reading S3 environment variables or constructing `S3Client` in route loaders, actions, or background workers.
**Added by:** spec 06.
