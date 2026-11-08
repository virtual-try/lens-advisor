# Spec 37 — Lab order dispatch tenancy scoping

**Status:** Not started
**Depends on:** Spec 34
**Model:** Standard — `claude-sonnet-4-5` · `gpt-5-codex` · `gemini-2.5-pro`
**Issue:** —
**Owns:** `app/features/lab-dispatch/lab-dispatch.repository.server.ts`, `app/features/lab-dispatch/jobs.server.ts`, `app/features/lab-orders/constants.ts`, `app/features/lab-dispatch/dispatch.test.ts`
**Reuses:** `INVARIANTS.md` (INV-1), `specs/30-lab-order-dispatch.md`
**Kind:** bugfix
**Invariants:** INV-1

## Goal

Ensure all database operations in the lab dispatch feature strictly adhere to multi-tenant isolation (INV-1). Require the verified job payload to carry both `shopId` and `labOrderId`, and scope `getLabOrderShopId` to query strictly by `{ id: labOrderId, shopId }` so that cross-tenant data access is impossible.

## Scope

- In `app/features/lab-orders/constants.ts`:
  - Update `dispatchJobPayloadSchema` to require `{ shopId: z.string(), labOrderId: z.string() }`.
- In `app/features/lab-dispatch/lab-dispatch.repository.server.ts`:
  - Scope `getLabOrderShopId` to accept `(shopId: string, labOrderId: string, db?: LabDispatchDb)` and query by `{ id: labOrderId, shopId }`, removing the unscoped lookup.
- In `app/features/lab-dispatch/jobs.server.ts`:
  - Consume `shopId` from the verified job payload and query by `{ id, shopId }`.
- In `app/features/lab-orders/intake.service.server.ts` (and any other dispatch enqueue callers):
  - Pass `{ shopId, labOrderId }` when enqueuing the dispatch job.
- Add test coverage in `app/features/lab-dispatch/dispatch.test.ts` proving two-shop tenant isolation: verify that a dispatch job for Shop A carrying Shop B's `labOrderId` cannot resolve or dispatch Shop B's lab order.

## Explicit non-scope

- Ticket rendering format changes (PDF or CSV).
- Mail delivery adapter changes.
- Database schema changes.

## Reuse first

- `app/shared/container/prisma.server.ts`
- `INV-1` tenancy rules in `INVARIANTS.md`

## Wiring

Real, used now: `dispatch-lab-order` pg-boss worker handler. In tests: two-shop isolation test suite. Stubbed: none. Consumers: orders webhook (Spec 23).

## Examples

| Pattern | Current Implementation | Scoped Implementation |
|---|---|---|
| Lab order shop resolution | `findUnique({ where: { id: labOrderId } })` | Job payload carries `{ shopId, labOrderId }`, querying by `{ id: labOrderId, shopId }` |

## Steps

1. Update `dispatchJobPayloadSchema` in `app/features/lab-orders/constants.ts` to require `{ shopId, labOrderId }`.
2. Refactor `getLabOrderShopId` in `app/features/lab-dispatch/lab-dispatch.repository.server.ts` to require `(shopId, labOrderId, db)` and query by `{ id: labOrderId, shopId }`.
3. Update `createDispatchHandler` in `app/features/lab-dispatch/jobs.server.ts` and dispatch queue producers to pass and consume `shopId`.
4. Add unit/integration tests in `dispatch.test.ts` explicitly asserting two-shop isolation on job execution.
5. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Self-check

1. `dispatch.test.ts` passes with explicit two-shop multi-tenant isolation tests.
2. Repository queries in `lab-dispatch` maintain INV-1 compliance with `{ id, shopId }` scoping.

## Done when

- [ ] `dispatchJobPayloadSchema` requires `{ shopId, labOrderId }` and `getLabOrderShopId` in `app/features/lab-dispatch/lab-dispatch.repository.server.ts` scopes query by `{ id: labOrderId, shopId }` (INV-1). [unit]
- [ ] Unit tests in `app/features/lab-dispatch/dispatch.test.ts` verify two-shop tenant isolation: a job for Shop A with Shop B's `labOrderId` cannot resolve or dispatch Shop B's lab order. [unit]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm test` passes with 0 failures. [suite]

## Log

- **2026-11-09** — Spec updated to require `{ shopId, labOrderId }` payload and scoped `{ id, shopId }` query, dropping documentation-only alternative (R3-F2).
- **2026-11-09** — Spec created to address unscoped `getLabOrderShopId` lookup violating INV-1 (R2-F2, R2-F6).
