# Spec 30 — Lab order dispatch job (ticket → S3 → email)

**Status:** Done
**Depends on:** Spec 05, Spec 06, Spec 07, Spec 14, Spec 15, Spec 23, Spec 24
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/features/lab-dispatch/`, `specs/inventory/30-lab-order-dispatch.md`
**Reuses:** `app/features/lab-orders/lab-orders.repository.server.ts` (spec 23), `app/features/lab-orders/jobs.server.ts` (spec 23), `app/features/lab-orders/ticket/` (spec 24), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/container/object-store.server.ts` (spec 06), `app/shared/container/mailer.server.ts` (spec 07), `app/shared/queue/` (spec 08), `app/features/settings/settings.service.server.ts` (spec 15), `app/features/catalog/catalog.repository.server.ts` (spec 14)
**Kind:** logic, storage
**Invariants:** INV-1, INV-2, INV-8

## Goal

For each queued lab order, build the ticket, store it in S3 and email it with any uploaded prescription
files to the shop's lab addresses — exactly once per order, with a status the merchant can see.

## Scope

- `app/features/lab-dispatch/jobs.server.ts` registers the handler for spec 23's `lab-orders.dispatch`
  (payload `{ labOrderId }`), retry 5 with backoff.
- `loadTicketData(shopId, labOrderId)`: LabOrder + lens/options/add-ons from the catalog (archived rows still
  readable) + prescription decrypted with AAD `shopId:prescriptionId` → `TicketData`. Its own repository
  file in this folder for status updates (spec 23's repository file is not edited).
- Flow: status SENDING (conditional update from PENDING/FAILED — a second worker loses) → render per
  `ticketFormat` → `putObject` at `shops/<shopId>/tickets/<labOrderId>.<ext>` → read upload files →
  `Mailer.send` with `idempotencyKey = labOrder.id + ':' + attempts` → SENT + `providerId`, `sentAt`.
- Errors: record `lastErrorCode` (`NO_LAB_EMAIL`, `MAIL_FAILED`, `STORAGE_FAILED`, `RX_DECRYPT_FAILED`),
  status FAILED, rethrow for retry except `NO_LAB_EMAIL` (permanent). Messages never carry Rx (INV-2).
- `resend(shopId, labOrderId)` service: re-enqueues; used by spec 32.

## Explicit non-scope

- Admin list and buttons → spec 32. Ticket layout → spec 24. Live lab APIs → not MVP.

## Reuse first

- Named in detail: `DISPATCH_JOB` name + lab-orders repository (23), `TicketData`/`renderPdf`/`renderCsv` (24), `getCipher` (05), `getObjectStore` (06), `getMailer` (07), `defineJob` (08), settings service (15), catalog repository (14)
- Renderers (24) and the container getters (05–07) — no new S3 or Resend client.

## Wiring

Real, used now: 05, 06, 07, 14, 15, 23, 24 (tests use the in-memory fakes each adapter spec ships, plus the real
test DB). Stubbed: none.

## Examples

| Situation | Expected | Why this row |
| --- | --- | --- |
| PENDING, format BOTH, 2 lab emails | 2 objects in S3, 1 email with 2 tickets attached, SENT | normal |
| UPLOAD Rx with 2 files | the 2 files attached as well | uploads |
| job delivered twice concurrently | 1 email, 1 SENT row | INV-8 |
| mailer throws | FAILED `MAIL_FAILED`, attempts+1, job retried | retry |
| no lab emails configured | FAILED `NO_LAB_EMAIL`, no retry | permanent |
| labOrderId of shop B in job for shop A | handler loads nothing, logs id only | INV-1 |
| Rx ciphertext tampered | FAILED `RX_DECRYPT_FAILED`, no email | integrity |

## Steps

1. Repository + `loadTicketData`; 2. handler; 3. `resend`; 4. Examples tests.

## Self-check

1. The SENDING transition is one conditional `UPDATE ... WHERE status IN (...)` — check the returned count.
2. Logs and `lastErrorCode` never include Rx values or file contents (INV-2) — test spies on the logger.
3. Archived lenses still render on old orders.
4. Logic + storage checklists (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/features/lab-dispatch` passes: every Examples row is a case. [unit]
- [x] INV-1: every repository query is tested with two shops. [unit]
- [x] INV-2: a logger spy across the failure rows finds no Rx value. [unit]
- [x] INV-8: the concurrent-delivery test sends exactly one email. [unit]
- [ ] A real dispatch reaches a test inbox with the PDF attached. [requires: Resend API key + verified domain, S3 bucket with KMS key]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/30-lab-order-dispatch.md` lists `loadTicketData`, the handler and `resend`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 30 implemented by coder agy-3 (engine agy) in worktree `spec-30` on branch `spec/30-lab-order-dispatch`. No git writes (lead commits).
- **2026-11-08** — Real dispatch to test inbox box left unticked per Ruling R7: requires live Resend account with verified domain and AWS S3 bucket with KMS key provided by owner.
- **2026-11-08** — Repository `app/features/lab-dispatch/lab-dispatch.repository.server.ts`:
  - `transitionToSending`: executes a single atomic `UPDATE ... RETURNING attempts` from `PENDING` or `FAILED` (incrementing attempts) or reclaiming a stale `SENDING` row (reusing existing attempts) (Self-check 1, R1-F2, R1-F9, R2-F9). Validates returned count: concurrent workers get `transitioned: false` and active workers throw retryable `IN_PROGRESS` (INV-8, R2-F4).
  - `markSent`, `markFailed`, `resetLabOrderStatus`, `getLabOrder`, `getPrescription`, `getLens`, `getOptionValues`, `getAddOns`: all take `shopId` as the first argument and strictly filter by it (INV-1).
  - `getLens`, `getOptionValues`, and `getAddOns` omit `archivedAt: null` filtering so archived lenses and options remain readable on old orders (Self-check 3).
- **2026-11-08** — Ticket Loader `app/features/lab-dispatch/load-ticket-data.server.ts`:
  - `loadTicketData`: loads LabOrder, catalog lens/options/add-ons, and decrypts prescription ciphertext using AES-256-GCM with context AAD `${shopId}:${prescriptionId}` (INV-2).
  - Throws data-free `RxDecryptError` (`RX_DECRYPT_FAILED`) on ciphertext tampering or AAD mismatch; never exposes Rx data in error message or stack.
  - Constructs `TicketData` with option selections for lab-code compilation (Spec 12/24).
- **2026-11-08** — Service & Job `app/features/lab-dispatch/dispatch.service.server.ts` & `jobs.server.ts`:
  - `processDispatch`: orchestrates status SENDING transition -> shop settings lab emails check (`NO_LAB_EMAIL`, permanent, no retry) -> `loadTicketData` (`RX_DECRYPT_FAILED`, retried) -> render ticket per `ticketFormat` (PDF, CSV, BOTH) and upload to S3 (`STORAGE_FAILED`, retried) -> download uploaded prescription files if source is UPLOAD (`STORAGE_FAILED`, retried) -> `Mailer.send` with `idempotencyKey = labOrder.id + ':' + attempts` (`MAIL_FAILED`, retried) -> update to `SENT` with `providerId`, `ticketKeys`, `sentAt`.
  - `resend`: validates tenancy (INV-1), resets order status to `PENDING`, clears `lastErrorCode`, and re-enqueues `lab-orders.dispatch`.
  - `dispatchJob`: registers the executable worker handler for `lab-orders.dispatch` with retry 5 and exponential backoff (`retryLimit: 5`, `retryDelay: 2`, `retryBackoff: true`).
- **2026-11-08** — Extension to `app/shared/queue/define-job.ts`:
  - Added `if (existing.handler && !definition.handler) return;` so that producer-less and consumer-bearing definitions can be discovered in either filesystem order without duplicate job definition errors.
  - Updated `app/features/lab-orders/intake.test.ts` line 1332 to assert discovered dispatch job now possesses the worker handler registered by spec 30.
- **2026-11-08** — Inventory fragment `specs/inventory/30-lab-order-dispatch.md`:
  - Documented `load-ticket-data`, `dispatch-handler`, `dispatch-service`, and `lab-dispatch-repository`.
- **2026-11-08** — Sabotage:
  - Bypassed `if (!rows || rows.length === 0)` in `transitionToSending` (`if (false && (!rows || rows.length === 0))`) -> `TypeError: Cannot read properties of undefined (reading 'attempts')` at `rows[0].attempts` across 4 tests (Self-check 1, INV-1, row 3 (INV-8), and R2-F4). Restored -> green.
- **2026-11-08** — Review round R1 fixes (coder agy-3):
  - Fixed R1-F1: Removed all `as any` casts and `eslint-disable-next-line` comments. Typed `queue` as `Pick<Queue, "enqueue">` in `DispatchServiceDeps` and test fakeQueue; typed `db` as `PrismaClient`. Gates restored without suppression.
  - Fixed R1-F2: Wrapped all steps after `transitionToSending` in `processDispatch` in try/catch to record `FAILED` with accurate code before rethrow, preventing stuck `SENDING` rows. Added `updatedAt` to `LabOrder` in `prisma/schema.prisma` and `20261107120000_init/migration.sql`, and implemented stale lease reclamation (`SENDING_STALE_TIMEOUT_MS = 15 * 60 * 1000`) in `transitionToSending` reusing existing `attempts`. Added tests for `markSent` throwing and stale-SENDING reclaim.
  - Fixed R1-F3: Extended INV-2 logger and console spies across `MAIL_FAILED` and `STORAGE_FAILED` failure rows where decrypted Rx resides in memory. Asserted zero clinical values (SPH/CYL/AXIS/PD/notes) leak in logger calls, `console.warn`/`console.error`, `err.message`, or `lastErrorCode`.
  - Fixed R1-F4: Resolved owning shop by id through new repository function `getLabOrderShopId` as the single id-to-shop resolver, then scoped all subsequent calls by that `shopId` (INV-1). Reused `dispatchJobPayloadSchema` from `app/features/lab-orders/constants.ts` with `{ labOrderId }`. Added handler tests for production no-shopId path (found and not-found).
  - Fixed R1-F5: Guarded `resend` to only allow transitions from `FAILED` or `SENT` to `PENDING`; refuses `PENDING` or `SENDING` with `ConflictError` (`code: "CONFLICT"`). Made `markSent` and `markFailed` conditional on `status = "SENDING"` so late workers cannot overwrite state. Added tests for resend during SENDING and late worker no-op.
  - Fixed R1-F6: Recorded cross-owner edits to spec 08's `app/shared/queue/define-job.ts` (allowing handler-bearing definition to merge with handler-less definition) and spec 23's `app/features/lab-orders/intake.test.ts` (worker handler presence assertion on discovered dispatch job and `updatedAt` inclusion in `allowedLabOrderFields`). Added test cases in `define-job.test.ts` for both registration orders (producer-first and consumer-first).
  - Fixed R1-F7: Added `LOAD_FAILED` (missing rows/DB errors) and `TICKET_RENDER_FAILED` (renderer errors) to `LabDispatchErrorCode` union, restricting `RX_DECRYPT_FAILED` strictly to decryption and integrity failures. Tested each.
  - Fixed R1-F8: Validated decrypted Rx payload with rx-core's `prescriptionSchema.safeParse` in `loadTicketData`. On failure, throws `RxDecryptError("Prescription payload validation failed")`, recording data-free `RX_DECRYPT_FAILED` and sending no email. Tested with corrupt Rx payload.
  - Fixed R1-F9: Changed `transitionToSending` to atomic single-statement `$queryRaw` executing `UPDATE ... RETURNING attempts`, eliminating race conditions between update and query.
  - Fixed R1-F10: Extended Self-check 3 test to archive an option value and an add-on in addition to the lens, asserting all archived labels appear in `ticketData`.
  - Fixed R1-F11: Asserted `dispatchJob.retry` options (`retryLimit: 5`, `retryBackoff: true`) and added fail-then-succeed test run ending `SENT` with attempts 2 and distinct idempotency key.
  - Fixed R1-F12: Dropped `getObject` duck-typing in upload file reading. Added `UPLOAD_DOWNLOAD_TIMEOUT_MS` (15s) and `UPLOAD_MAX_FILE_SIZE_BYTES` (10MB) bounds. Tested presign-and-fetch path with injected `fetch` (HTTP 200 success, HTTP 403 failure).
- **2026-11-08** — Review round R2 fixes (coder agy-3):
  - Fixed R2-F1: Seeded `orderBSending` as `SENDING` in shop B in INV-1 test; asserted `markSent(shopA, orderBSending)` and `markFailed(shopA, orderBSending)` return null and that shop B's row remains untouched in `SENDING` with null providerId and lastErrorCode.
  - Fixed R2-F2: Enforced presence checks in `loadTicketData` for lens (`LENS_NOT_FOUND`), unique option values (`OPTION_VALUE_NOT_FOUND`), unique add-ons (`ADD_ON_NOT_FOUND`), and prescription (`RX_NOT_FOUND`), preventing blank or incomplete tickets. Process dispatch records `FAILED LOAD_FAILED` and sends no email. Tested each missing kind.
  - Fixed R2-F3: If email send succeeded but `markSent` throws, leave row in `SENDING` without marking `FAILED` or incrementing attempts. On retry, stale lease reclaim reuses the exact same attempts and idempotency key, allowing mail provider deduplication (INV-8). Tested throw after send and key reuse on retry.
  - Fixed R2-F4: When `transitionToSending` returns false for a fresh `SENDING` row, throw retryable `DispatchInProgressError` (`IN_PROGRESS`) instead of returning `SKIPPED`, ensuring crashed workers are reclaimed by pg-boss retries. Only return `SKIPPED` for `SENT` or not found. Tested fresh SENDING error and handler throw.
  - Fixed R2-F5: Passed typed fakeQueue to `resend(shopA, orderB)` in INV-1 test, asserted `rejects.toThrow(NotFoundError)`, verified `fakeQueue.enqueue` was not called, and asserted `orderB` status was unchanged.
  - Fixed R2-F6: Checked result of `resetLabOrderStatus` in `resend` (throws `ConflictError` if null). Wrapped `queue.enqueue` in try/catch to revert order status and lastErrorCode if enqueue throws, preventing stranded `PENDING` rows. Tested both race/conflict and rollback on enqueue failure.
  - Fixed R2-F7: Enforced streaming size cap (`UPLOAD_MAX_FILE_SIZE_BYTES` = 10MB) checking Content-Length header first, then running chunk byte totals with stream cancellation, plus download timeout abort. Tested oversized stream, Content-Length cap, and timeout with injected fetch.
  - Fixed R2-F8: Removed unused `s3Reader` test hook from `DispatchServiceDeps` and production download branch.
  - Fixed R2-F9: Changed `transitionToSending` to pass a single JS Date parameter (`now`) for both `"updatedAt" = ${now}` write and stale cutoff `"updatedAt" <= ${staleCutoff}`, eliminating DB session time zone skew on timestamp without time zone. Tested parameter passing.
  - Fixed R2-F11: Removed duplicate `expect(handled).toBe(false)` assertion in `app/shared/queue/define-job.test.ts`. Refreshed Spec 30 Log counts and transitionToSending description.
- **2026-11-08** — Review round R3 fixes (coder agy-3):
  - Fixed R3-F1: When `markSent` fails after email send, or when a worker meets a fresh `SENDING` lease, enqueue a delayed dispatch job for `labOrderId` with `startAfter = lease expiry + DELAY_MARGIN_MS` (5s) and `singletonKey = ${labOrderId}:delayed:${leaseWindowStart}`. Worker handler catches `DispatchInProgressError` on fresh lease and completes cleanly without burning retries. After lease expiry, the delayed job reclaims the stale lease and completes `SENT` using the same attempts and idempotency key. Tested with injected clock and fakeQueue across the full retry and recovery cadence. Extended `EnqueueOptions` in `app/shared/queue/queue.ts` to support `startAfter`.
  - Fixed R3-F2: Added dedicated Row 6 test in `dispatch.test.ts` for "labOrderId of shop B in job for shop A -> returns SKIPPED/order_not_found, nothing written, no email, logs ids only (INV-1)". Verified no email sent, no S3 writes, shop B's row unchanged, nothing written in shop A, and log metadata carries IDs only.
  - Fixed R3-F3: Updated `resetLabOrderStatus` cross-shop isolation test in `dispatch.test.ts` to seed shop B's row as `FAILED` with `lastErrorCode: "MAIL_FAILED"`. Asserted `resetLabOrderStatus(shopA.id, orderBFailed.id)` returns `null` and shop B's row remains `FAILED` with its `lastErrorCode` intact.
  - Fixed R3-F4: Handled return values of `markSent` and `markFailed`. If `markSent` returns `null` (count 0, lost lease / slow worker), logs `lab_dispatch.lost_lease` and returns `{ status: "SKIPPED", reason: "lost_lease" }`, never `SENT`. If `markFailed` returns `null` (count 0), logs and returns `{ status: "SKIPPED", reason: "lost_lease" }`. Tested both cases in `dispatch.test.ts`.
  - Fixed R3-F5: Confirmed that no database has been deployed yet (pre-release, spec 23 precedent). State that in the Log. Before release the migrations are squashed or baselined, a release step tracked under D4.
  - Fixed R3-F6: Redid sabotage against the `UPDATE ... RETURNING` `rows.length` check (`if (!rows || rows.length === 0)`) in `transitionToSending`; updated the Log's Sabotage entry with the red/green verification.
- **2026-11-08** — Gates verified:
  - `pnpm vitest run app/features/lab-dispatch`: 1 test file, 33/33 passed.
  - `pnpm test`: 52 test files, 850/850 passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (0 errors, 0 warnings).
  - `pnpm build`: exit 0.
  - `git diff --check`: clean.
- **2026-11-08** — Evidence (orchestro spec verify, tree c304a179): install pass · typecheck pass · lint pass · build pass · test pass 1128/0/0
