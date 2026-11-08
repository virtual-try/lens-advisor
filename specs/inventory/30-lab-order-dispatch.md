# Inventory fragment — Spec 30 (Lab order dispatch job (ticket → S3 → email))

### `load-ticket-data`
`app/features/lab-dispatch/load-ticket-data.server.ts` — `loadTicketData(shopId, labOrderId, deps)`:
- Loads `LabOrder` and referenced catalog entities (`Lens`, `OptionValue`, `AddOn`), ensuring archived catalog rows remain readable for old orders (Self-check 3).
- Decrypts the prescription ciphertext using AES-256-GCM with context AAD `${shopId}:${prescriptionId}` (INV-2).
- Validates the decrypted payload with rx-core's `prescriptionSchema` (R1-F8); fails with data-free `RxDecryptError` (`RX_DECRYPT_FAILED`) if decryption or schema validation fails.
- Formats selections and options for lab-code compilation (Spec 12 / Spec 24).
- Returns structured `TicketData` for PDF and CSV renderers (Spec 24).
**Use instead of:** Ad-hoc order/lens/prescription joins and unverified ciphertext handling.
**Added by:** spec 30.

### `dispatch-handler`
`app/features/lab-dispatch/jobs.server.ts` — `dispatchJob`:
- Registers the worker handler for `lab-orders.dispatch` with pg-boss (`retryLimit: 5`, `retryDelay: 2`, `retryBackoff: true`).
- Validates job payload `{ labOrderId: string }` via `dispatchJobPayloadSchema` (INV-2, R1-F4).
- Resolves owning shop by id through repository function `getLabOrderShopId`, then scopes all subsequent reads and writes strictly by that shopId (INV-1, R1-F4).
- Invokes `processDispatch` to execute the ticket generation, S3 storage, and Resend email pipeline.
**Use instead of:** Unregistered or stubbed dispatch background jobs.
**Added by:** spec 30.

### `dispatch-service`
`app/features/lab-dispatch/dispatch.service.server.ts` — `processDispatch` and `resend`:
- `processDispatch(shopId, labOrderId, deps)`: Orchestrates the dispatch lifecycle:
  1. Transitions order status to SENDING via atomic conditional update; reclaims stale SENDING rows older than 15 min reusing existing attempts (R1-F2, R1-F9).
  2. Wraps the entire body after transition so any throw calls `markFailed` before rethrowing; rows never stick in SENDING (R1-F2).
  3. Resolves lab emails from `getSettings` (Spec 15); fails permanently with `NO_LAB_EMAIL` if missing (no retry).
  4. Loads and decrypts ticket data (`loadTicketData`); fails with `RX_DECRYPT_FAILED` on tamper/schema errors (retried), or `LOAD_FAILED` on missing rows (R1-F7).
  5. Renders ticket per `ticketFormat` (`PDF`, `CSV`, or `BOTH`); fails with `TICKET_RENDER_FAILED` on renderer errors (R1-F7) and stores in S3 under `shops/<shopId>/tickets/<labOrderId>.<ext>` using `putObject` (Spec 06).
  6. Downloads uploaded prescription files from S3 via presigned URLs bounded by timeout (15s) and size cap (10MB) (R1-F12).
  7. Sends email to lab addresses via `Mailer.send` with `idempotencyKey = labOrderId + ':' + attempts` (Spec 07); fails with `MAIL_FAILED` on provider error (retried).
  8. Updates order status to `SENT` with `providerId`, `ticketKeys`, and `sentAt`.
- `resend(shopId, labOrderId, deps)`: Validates order tenancy (INV-1), conditionally resets order status to `PENDING` (clearing `lastErrorCode`), and re-enqueues `lab-orders.dispatch`. Refuses `PENDING` or `SENDING` with `ConflictError` (R1-F5). Used by Spec 32 admin interface.
**Use instead of:** Inline dispatch workflows in webhook routes or admin UI loaders.
**Added by:** spec 30.

### `lab-dispatch-repository`
`app/features/lab-dispatch/lab-dispatch.repository.server.ts` — Tenancy-scoped database access functions for lab order dispatch:
- `transitionToSending(shopId, labOrderId, db)`: Executes atomic conditional `UPDATE ... RETURNING attempts` statement via `$queryRaw` from `PENDING` or `FAILED` (incrementing attempts) or reclaims stale `SENDING` lease older than 15 min (reusing attempts) (Self-check 1, R1-F2, R1-F9).
- `getLabOrderShopId(labOrderId, db)`: Documented as the only id-to-shop resolver for internal job queue payloads (R1-F4).
- `markSent(shopId, labOrderId, data, db)`: Updates order status to `SENT` conditional on `status = 'SENDING'` (R1-F5).
- `markFailed(shopId, labOrderId, errorCode, db)`: Updates order status to `FAILED` conditional on `status = 'SENDING'` (R1-F5).
- `resetLabOrderStatus(shopId, labOrderId, status, db)`: Conditionally resets status (`status IN ('FAILED', 'SENT')`); refuses `PENDING`/`SENDING` with `ConflictError` (R1-F5).
- `getLabOrder(shopId, labOrderId, db)`: Fetches a lab order scoped to `shopId` (INV-1).
- `getPrescription(shopId, prescriptionId, db)`: Fetches prescription row scoped to `shopId` (INV-1).
- `getLens(shopId, lensId, db)`: Fetches lens row (including archived) scoped to `shopId` (INV-1).
- `getOptionValues(shopId, optionValueIds, db)`: Fetches option values scoped to `shopId` (INV-1).
- `getAddOns(shopId, addOnIds, db)`: Fetches add-ons scoped to `shopId` (INV-1).
**Use instead of:** Mutating `app/features/lab-orders/lab-orders.repository.server.ts` or unscoped DB queries.
**Added by:** spec 30.
