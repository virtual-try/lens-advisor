# Spec 23 — orders/create webhook → lab orders

**Status:** Not started
**Depends on:** Spec 02, Spec 08, Spec 11, Spec 22
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/routes/webhooks.orders.create.ts`, `app/features/lab-orders/lab-orders.repository.server.ts`, `app/features/lab-orders/intake.service.server.ts`, `app/features/lab-orders/intake.test.ts`, `app/features/lab-orders/jobs.server.ts`, `specs/inventory/23-orders-webhook.md`
**Reuses:** `packages/rx-core/src/cart/bundle-properties.ts` (spec 03), `packages/rx-core/src/limits/` (spec 11), `app/features/prescriptions/` (spec 22), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/queue/` (spec 08), `app/shopify.server.ts` (spec 01)
**Kind:** api, storage, logic
**Invariants:** INV-1, INV-2, INV-6, INV-8

## Goal

When an order is placed, every lens bundle in it becomes one `LabOrder` row linked to its prescription and
a dispatch job is queued — fast enough for Shopify's 5-second webhook timeout, and safe to receive twice.

## Scope

- Route: `authenticate.webhook` → enqueue `lab-orders.intake` with `{ shopId, shopifyOrderId }` only
  (singleton key = order id) → 200. The full payload is not stored in the job (INV-2, INV-8).
  The job fetches the order via Admin GraphQL (line items, custom attributes, nested-line parent ids).
- Intake job: group lines by `_bundle_id`; per bundle read lens line `_item_id`, `_option_ids`,
  `_addon_ids`, `_rx_ref`; frame title/SKU from the parent line. Upsert `LabOrder` (unique shop+order+bundle),
  `attachOrder` on the prescription, compute `rxOutOfLimits` via `checkLens` on the decrypted Rx, then
  enqueue `lab-orders.dispatch` `{ labOrderId }` (handler in spec 30, name exported here as a constant).
- Orders with no `_bundle_id` lines → no rows, job completes.
- `_rx_ref` from another shop or unknown → LabOrder created with `prescriptionId = null`, status FAILED,
  `lastErrorCode = RX_NOT_FOUND` (visible in spec 32), no dispatch.

## Explicit non-scope

- Rendering and emailing → specs 24, 30. Order edits/cancellations → not MVP (README Open questions).

## Reuse first

- Named in detail: `readBundleProperties` (03), `checkLens` (11), prescriptions repository `attachOrder`/`getById` (22), `getCipher` (05 via 22's service), `defineJob`/`getQueue` (08), `authenticate.webhook`
- spec 03 property reader — no ad-hoc parsing of `_bundle_*` keys.

## Wiring

Real, used now: 02, 08, 11, 22. Tests: fake admin client returning fixture orders; real test DB and queue.
Stubbed until spec 30 — test code only: the `lab-orders.dispatch` handler; tests assert it was enqueued.

## Examples

| Order fixture | Expected | Why this row |
| --- | --- | --- |
| 1 frame + lens + 2 options, Rx in limits | 1 LabOrder PENDING, `rxOutOfLimits=false`, 1 dispatch job | normal |
| 2 bundles in one order | 2 LabOrders, 2 jobs | multi |
| same webhook delivered twice | still 1 LabOrder per bundle, 1 job each | INV-8 |
| Rx SPH −9.00, lens min −8.00 | `rxOutOfLimits=true`, still dispatched | flag, not block |
| `_rx_ref` of shop B in shop A's order | FAILED `RX_NOT_FOUND`, no dispatch | INV-1 |
| order with no bundle lines | nothing written | unrelated order |
| invalid HMAC | 401, nothing enqueued | INV-6 |

## Steps

1. Repository; 2. route; 3. intake service + job; 4. Examples tests.

## Self-check

1. Route does no DB or Admin API work beyond enqueue (INV-8) — test with a spy.
2. Upsert is a single statement on the unique key; a concurrent duplicate cannot create two rows.
3. Decrypted Rx is used for the limits check and discarded — never stored on the LabOrder (INV-2).
4. Api + storage + logic checklists (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/features/lab-orders/intake.test.ts` passes: every Examples row is a case. [unit]
- [x] INV-1: the cross-shop `_rx_ref` row passes; repository functions tested with two shops. [unit]
- [x] INV-2: job payload schemas hold ids only (spec 08 guard) and LabOrder has no Rx field. [unit]
- [x] INV-6: invalid HMAC returns 401 with no enqueue. [unit]
- [x] INV-8: duplicate delivery test above; route test asserts no DB call inside the request. [unit]
- [ ] A real test order on a dev store produces a LabOrder row. [requires: Shopify dev store, protected customer data Level 1 enabled]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/23-orders-webhook.md` lists the repository, job names, intake service. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 23 implemented by coder agy-3 (engine agy) in worktree `spec-23` on branch `spec/23-orders-webhook`. No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Real test order on dev store box left unticked per Ruling R7: requires live Shopify dev store and protected customer data Level 1 enabled by owner.
- **2026-11-08** — Implemented repository `app/features/lab-orders/lab-orders.repository.server.ts`:
  - `upsertLabOrder`: atomic single-statement upsert on `(shopId, shopifyOrderId, bundleId)` (Self-check 2). Concurrent duplicate calls cannot create duplicate rows.
  - `getLabOrderById`, `getLabOrderByShopifyOrderAndBundle`, `listLabOrdersByShop`: all shop-scoped (INV-1).
- **2026-11-08** — Implemented background jobs `app/features/lab-orders/jobs.server.ts`:
  - Defined `lab-orders.intake` (`INTAKE_JOB_NAME`) with payload `{ shopId, shopifyOrderId }` only (INV-2, INV-8).
  - Defined `lab-orders.dispatch` (`DISPATCH_JOB_NAME`) with payload `{ labOrderId }` only (INV-2). Handler stubbed until spec 30.
  - Job payload schemas validated with spec 08 guards; only string IDs (`*Id`) allowed.
- **2026-11-08** — Implemented domain service `app/features/lab-orders/intake.service.server.ts`:
  - `processOrderIntake`: fetches order details via Admin GraphQL (`ORDER_INTAKE_QUERY`), groups lines by `_bundle_id`, parses lens properties via `readBundleProperties` (spec 03), extracts frame title and SKU from frame line, validates prescription shop tenancy (`getPrescriptionById`), links prescription to order (`attachOrder`), decrypts manual Rx in memory for `checkLens` (spec 11) without storing plaintext Rx on `LabOrder` (INV-2, Self-check 3), upserts `LabOrder` row, and enqueues `lab-orders.dispatch` with `{ labOrderId }` and `singletonKey = labOrderId`.
  - Handles missing / unknown / cross-shop `_rx_ref` by upserting `LabOrder` with `prescriptionId = null`, `status = FAILED`, `lastErrorCode = RX_NOT_FOUND`, and no dispatch.
  - Orders without bundle lines complete immediately with 0 rows written and 0 jobs enqueued.
  - Helpers: `toOrderGid`, `fromOrderGid`, `extractAttributesRecord`.
- **2026-11-08** — Implemented webhook route `app/routes/webhooks.orders.create.ts`:
  - Authenticates HMAC signature via `authenticate.webhook` (INV-6); invalid HMAC returns 401 without enqueueing.
  - Zero DB queries and zero Admin API calls performed inside the request handler (INV-8, Self-check 1).
  - Enqueues `lab-orders.intake` with `{ shopId, shopifyOrderId }` only and `singletonKey = orderId` (INV-2, INV-8), returning 200 fast.
- **2026-11-08** — Created inventory fragment `specs/inventory/23-orders-webhook.md`.
- **2026-11-08** — Implemented unit and integration test suite `app/features/lab-orders/intake.test.ts`:
  - Covered all 7 rows of the Examples table (normal order, multi-bundle order, duplicate webhook delivery, out-of-limits flag, cross-shop prescription refusal, order without bundle lines, invalid HMAC).
  - INV-1 verified across two seeded shops for all repository functions and intake flow.
  - INV-2 verified: payload schemas hold IDs only, `LabOrder` has zero Rx diopter columns in Prisma DMMF, captured console logs contain no Rx values.
  - INV-8 verified: duplicate delivery yields 1 LabOrder and 1 dispatch job; route test asserts no DB calls inside the request handler.
  - Self-check 1 verified: route does no DB or Admin API work beyond enqueue (verified with spies on `getPrisma` and `unauthenticated.admin`).
  - Self-check 2 verified: concurrent `upsertLabOrder` calls on identical unique key produce exactly one row.
  - Self-check 3 verified: decrypted Rx is used in local memory for limits check and discarded, never stored on `LabOrder`.
  - Self-check 4 verified: API + storage + logic checklists hold.
- **2026-11-08** — Sabotage verifications:
  - Sabotage 1: Bypassed cross-shop prescription check in `intake.service.server.ts` (`this.db.prescription.findFirst({ where: { id: rxRef } })`) → Row 5 test went red with `DecryptError: Ciphertext could not be authenticated`. Restored → green.
  - Sabotage 2: Injected DB call in `webhooks.orders.create.ts` (`getPrisma()`) → route test went red with `AssertionError: expected "getPrisma" to not be called at all, but actually been called 1 times`. Restored → green.
  - Sabotage 3: Inverted limits check `rxOutOfLimits = checkResult.available` in `intake.service.server.ts` → Row 1 and Row 4 tests went red with `AssertionError: expected true to be false` and `AssertionError: expected false to be true`. Restored → green.
- **2026-11-08** — Gates after final source changes:
  - `pnpm vitest run app/features/lab-orders/intake.test.ts`: Test Files 1 passed (1), Tests 15 passed (15).
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (0 errors, 0 warnings).
  - `pnpm build`: exit 0.
  - `pnpm test`: Test Files 48 passed (48), Tests 767 passed (767), 0 failures.
  - `git diff --check`: clean.
- **2026-11-08** — Evidence (orchestro spec verify, tree bcd06bdd): install pass · typecheck pass · lint pass · build pass · test pass 773/0/0
- **2026-11-08** — Fix round R1 (coder agy-3):
  - Fixed R1-F1: Dropped `parentLineItem` from `ORDER_INTAKE_QUERY`, `RawLineItem`, and frame resolution logic; frame line identified via spec 03's `readBundleProperties` (`role === "frame"`). Added 2026-10 LineItem schema-contract test.
  - Fixed R1-F2: Registered `dispatchJob` as a producer schema without a production worker handler (`dispatchJob.handler === undefined`), avoiding premature job completion before spec 30.
  - Fixed R1-F3: Preserved terminal/workflow fields (`status`, `lastErrorCode`, `attempts`, `ticketKeys`, etc.) on conflict in `upsertLabOrder`. In `processOrderIntake`, only enqueue dispatch if `labOrder.status === "PENDING"`. Added test proving existing SENT/FAILED row retains status without re-dispatch.
  - Fixed R1-F4: Authenticated webhook request failures return standard 401 JSON shape (`error.code: "UNAUTHORIZED"`). Payload validated with Zod (`orderWebhookPayloadSchema`); malformed payload returns 400 with no enqueue and logs error code only (INV-2).
  - Fixed R1-F5: Added cursor pagination for lineItems in `ORDER_INTAKE_QUERY` and `processOrderIntake` using `pageInfo.hasNextPage` and `pageInfo.endCursor`. Tested orders of 250 and 251 line items across page boundaries.
  - Fixed R1-F6: Updated INV-6 test to assert that invalid HMAC returns 401 with standard JSON error body and that nothing is enqueued (`getQueue` and `fakeQueue.enqueue` not called).
  - Fixed R1-F7: Updated INV-1 test to seed identical order ID and bundle ID for shop A and shop B, updated shop A, and asserted that shop B's complete row remains byte-for-byte unchanged.
  - Fixed R1-F8: Made the no-Rx check structural on Prisma DMMF `LabOrder`: verified `'rx'` is absent, verified no field matches `/rx|sph|cyl|axis|add|pd|prism/i` except allowed names (`prescriptionId`, `prescription`, `rxOutOfLimits`, `addOnIds`), and verified exact allowed model field set.
