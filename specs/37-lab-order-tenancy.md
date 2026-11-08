# Spec 37 — Lab order dispatch tenancy scoping

**Status:** Not started
**Depends on:** Spec 34
**Model:** Standard — `claude-sonnet-4-5` · `gpt-5-codex` · `gemini-2.5-pro`
**Issue:** —
**Owns:** `app/features/lab-dispatch/lab-dispatch.repository.server.ts`, `app/features/lab-dispatch/jobs.server.ts`, `app/features/lab-dispatch/dispatch.test.ts`
**Reuses:** `INVARIANTS.md` (INV-1), `specs/30-lab-order-dispatch.md`
**Kind:** bugfix
**Invariants:** INV-1

## Goal

Ensure all database operations in the lab dispatch feature strictly adhere to multi-tenant isolation (INV-1). Eliminate unscoped queries or document and verify the trusted internal queue boundary with tests so that cross-tenant data access is impossible.

## Scope

- In `app/features/lab-dispatch/lab-dispatch.repository.server.ts`:
  - Audit `getLabOrderShopId(labOrderId, db)` which currently performs `findUnique({ where: { id: labOrderId }, select: { shopId: true } })` without tenant scoping.
  - Either:
    - Scope the lookup: update the job payload contract (`dispatchJob`) to carry `shopId` alongside `labOrderId` so all queries are scoped by `shopId` from the start, OR
    - Explicitly document and prove why `getLabOrderShopId` is a trusted internal queue lookup (job payload enqueued strictly by internal queue producer from our own database rows) and ensure subsequent queries strictly scope to that `shopId`.
- Add test coverage in `app/features/lab-dispatch/dispatch.test.ts` proving two-shop tenant isolation and verifying that jobs for Shop A cannot access or dispatch Shop B's lab orders.

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
| Lab order shop resolution | `findUnique({ where: { id: labOrderId } })` | Payload carries `{ labOrderId, shopId }`, or validated lookup with isolation assertions |

## Steps

1. Review `dispatchJob` payload schema and queue producer/consumer contracts.
2. Refactor `getLabOrderShopId` or pass `shopId` through job payload.
3. Add unit/integration tests in `dispatch.test.ts` explicitly asserting two-shop isolation on job execution.
4. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Self-check

1. `dispatch.test.ts` passes with explicit multi-tenant isolation tests.
2. Repository queries in `lab-dispatch` maintain INV-1 compliance.

## Done when

- [ ] `getLabOrderShopId` / lab order resolution in `app/features/lab-dispatch/` is scoped by `shopId` or tested and documented as a trusted internal queue boundary satisfying INV-1. [unit]
- [ ] Unit tests in `app/features/lab-dispatch/dispatch.test.ts` verify two-shop tenant isolation and reject cross-tenant data access. [unit]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm test` passes with 0 failures. [suite]

## Log

- **2026-11-09** — Spec created to address unscoped `getLabOrderShopId` lookup violating INV-1 (R2-F2, R2-F6).
