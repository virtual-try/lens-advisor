# Inventory fragment — Spec 30 (Lab order dispatch job (ticket → S3 → email))

### `load-ticket-data`
`app/features/lab-dispatch/load-ticket-data.server.ts` — `loadTicketData(shopId, labOrderId, deps)`:
- Loads `LabOrder` and referenced catalog entities (`Lens`, `OptionValue`, `AddOn`), ensuring archived catalog rows remain readable for old orders (Self-check 3).
- Decrypts the prescription ciphertext using AES-256-GCM with context AAD `${shopId}:${prescriptionId}` (INV-2).
- Formats selections and options for lab-code compilation (Spec 12 / Spec 24).
- Throws `RxDecryptError` (`RX_DECRYPT_FAILED`) if decryption or tamper checks fail, ensuring error messages contain zero plaintext Rx data (INV-2).
- Returns structured `TicketData` for PDF and CSV renderers (Spec 24).
**Use instead of:** Ad-hoc order/lens/prescription joins and unverified ciphertext handling.
**Added by:** spec 30.

### `dispatch-handler`
`app/features/lab-dispatch/jobs.server.ts` — `dispatchJob`:
- Registers the worker handler for `lab-orders.dispatch` with pg-boss (`retryLimit: 5`, `retryDelay: 2`, `retryBackoff: true`).
- Validates job payload `{ labOrderId: string, shopId?: string }` via `dispatchJobPayloadSchema` (INV-2).
- Enforces shop isolation: if `shopId` is passed, asserts that `labOrderId` belongs to `shopId` before loading; logs ID only if mismatched (INV-1).
- Invokes `processDispatch` to execute the ticket generation, S3 storage, and Resend email pipeline.
**Use instead of:** Unregistered or stubbed dispatch background jobs.
**Added by:** spec 30.

### `dispatch-service`
`app/features/lab-dispatch/dispatch.service.server.ts` — `processDispatch` and `resend`:
- `processDispatch(shopId, labOrderId, deps)`: Orchestrates the dispatch lifecycle:
  1. Conditionally transitions order status from PENDING/FAILED to SENDING (single update statement, Self-check 1, INV-8).
  2. Resolves lab emails from `getSettings` (Spec 15); fails permanently with `NO_LAB_EMAIL` if missing (no retry).
  3. Loads and decrypts ticket data (`loadTicketData`); fails with `RX_DECRYPT_FAILED` on tamper/decrypt errors (retried).
  4. Renders ticket per `ticketFormat` (`PDF`, `CSV`, or `BOTH`) and stores in S3 under `shops/<shopId>/tickets/<labOrderId>.<ext>` using `putObject` (Spec 06).
  5. Downloads uploaded prescription files from S3 if prescription source is `UPLOAD`.
  6. Sends email to lab addresses via `Mailer.send` with `idempotencyKey = labOrderId + ':' + attempts` (Spec 07); fails with `MAIL_FAILED` on provider error (retried).
  7. Updates order status to `SENT` with `providerId`, `ticketKeys`, and `sentAt`.
- `resend(shopId, labOrderId, deps)`: Validates order tenancy (INV-1), resets order status to `PENDING` (clearing `lastErrorCode`), and re-enqueues `lab-orders.dispatch`. Used by Spec 32 admin interface.
**Use instead of:** Inline dispatch workflows in webhook routes or admin UI loaders.
**Added by:** spec 30.

### `lab-dispatch-repository`
`app/features/lab-dispatch/lab-dispatch.repository.server.ts` — Tenancy-scoped database access functions for lab order dispatch:
- `transitionToSending(shopId, labOrderId, db)`: Executes atomic conditional `updateMany` for status transition from `PENDING` or `FAILED` to `SENDING` and increments attempts (Self-check 1).
- `markSent(shopId, labOrderId, data, db)`: Updates order status to `SENT` with `providerId`, `ticketKeys`, and `sentAt`.
- `markFailed(shopId, labOrderId, errorCode, db)`: Updates order status to `FAILED` with `lastErrorCode`.
- `resetLabOrderStatus(shopId, labOrderId, status, db)`: Resets status (e.g. to `PENDING`) and clears `lastErrorCode`.
- `getLabOrder(shopId, labOrderId, db)`: Fetches a lab order scoped to `shopId` (INV-1).
- `getPrescription(shopId, prescriptionId, db)`: Fetches prescription row scoped to `shopId` (INV-1).
- `getLens(shopId, lensId, db)`: Fetches lens row (including archived) scoped to `shopId` (INV-1).
- `getOptionValues(shopId, optionValueIds, db)`: Fetches option values scoped to `shopId` (INV-1).
- `getAddOns(shopId, addOnIds, db)`: Fetches add-ons scoped to `shopId` (INV-1).
**Use instead of:** Mutating `app/features/lab-orders/lab-orders.repository.server.ts` or unscoped DB queries.
**Added by:** spec 30.
