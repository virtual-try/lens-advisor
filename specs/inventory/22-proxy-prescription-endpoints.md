# Inventory fragment — Spec 22 (App proxy: prescription submit and upload endpoints)

### `proxy-upload-url-endpoint`
`app/routes/proxy.upload-url.ts` — Storefront app proxy endpoint `POST /apps/lens-advisor/upload-url`. Authenticates proxy signature (`authenticate.public.appProxy`, INV-6), enforces in-memory rate limiting (20 req/min/shop+IP), validates payload `{ contentType, size, draftId? }` via `uploadUrlRequestSchema`, creates a draft `Prescription` (source `UPLOAD`) when `draftId` is omitted, and returns `{ draftId, uploadUrl, key }` with an SSE-KMS presigned S3 upload URL.
**Use instead of:** Unsigned uploads or direct S3 client instantiation from storefront code.
**Added by:** spec 22.

### `proxy-prescriptions-endpoint`
`app/routes/proxy.prescriptions.ts` — Storefront app proxy endpoint `POST /apps/lens-advisor/prescriptions`. Authenticates proxy signature (`authenticate.public.appProxy`, INV-6), rate limits, validates payload `{ rxType, prescription?, draftId?, uploadedKeys? }` via `prescriptionSubmitBodySchema`. Re-validates clinical rules via spec 10 (`validatePrescription`); for `MANUAL` encrypts Rx payload into AES-256-GCM token using AAD `shopId:prescriptionId` (spec 05, INV-2); for `UPLOAD` validates that each key is under `shops/<shopId>/rx/<draftId>/` and exists in S3 via `headObject`. Returns `{ rxRef }` (HTTP 201).
**Use instead of:** Storing unvalidated or plaintext prescription data in Shopify cart properties or custom tables.
**Added by:** spec 22.

### `prescriptions-repository`
`app/features/prescriptions/prescriptions.repository.server.ts` — Shop-scoped Prisma data access functions (`createPrescription`, `getPrescriptionById`, `attachOrder`, `updatePrescriptionUpload`, `findShopByDomain`) guaranteeing multi-tenant shop isolation (INV-1). Queries filter by `(shopId, id)` unique constraint and return plain DTOs.
**Use instead of:** Raw Prisma queries on the `Prescription` model or cross-shop reads/writes.
**Added by:** spec 22.

### `prescriptions-service`
`app/features/prescriptions/prescriptions.service.server.ts` — Domain service (`createPrescriptionsService`, `PrescriptionsService`) encapsulating prescription submission business rules, spec 10 re-validation, AAD binding before encryption, S3 key prefix validation, and storage integrity checks. Accepts plain values in/out with zero HTTP or `react-router` dependencies.
**Use instead of:** Placing prescription business logic, validation, or cipher calls inside route actions or loaders.
**Added by:** spec 22.

### `prescription-rate-limiter`
`app/features/prescriptions/rate-limiter.server.ts` — In-memory rolling-window rate limiter (`MemoryRateLimiter`, singleton `prescriptionRateLimiter`) enforcing 20 requests per minute per shop+IP with 429 `RATE_LIMITED` responses.
**Use instead of:** Unbounded public app proxy endpoints.
**Added by:** spec 22.
