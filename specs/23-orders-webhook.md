# Spec 23 — orders/create webhook → lab orders

**Status:** Done
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

- [ ] `pnpm vitest run app/features/lab-orders/intake.test.ts` passes: every Examples row is a case. [unit]
- [ ] INV-1: the cross-shop `_rx_ref` row passes; repository functions tested with two shops. [unit]
- [ ] INV-2: job payload schemas hold ids only (spec 08 guard) and LabOrder has no Rx field. [unit]
- [ ] INV-6: invalid HMAC returns 401 with no enqueue. [unit]
- [ ] INV-8: duplicate delivery test above; route test asserts no DB call inside the request. [unit]
- [ ] A real test order on a dev store produces a LabOrder row. [requires: Shopify dev store, protected customer data Level 1 enabled]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/23-orders-webhook.md` lists the repository, job names, intake service. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
