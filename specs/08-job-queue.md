# Spec 08 — Job queue and worker process (pg-boss)

**Status:** Not started
**Depends on:** Spec 01
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/shared/queue/`, `app/shared/container/queue.server.ts`, `app/worker.server.ts`, `app/worker.server.test.ts`, `specs/inventory/08-job-queue.md`
**Reuses:** `app/shared/config.server.ts` (spec 01), `../docs/research/libraries.md`
**Kind:** integration
**Invariants:** INV-2, INV-8

## Goal

A typed `Queue` the web process can enqueue to and a worker entry that discovers and runs every feature's
job handlers, with retries and idempotent keys.

## Scope

- `Queue.enqueue(name, payload, { singletonKey?, retryLimit, retryDelay, retryBackoff })` and
  `defineJob({ name, schema, handler, retry })`. Payload validated by the job's zod schema on enqueue and
  on receive. Payload schemas may contain only ids and enums (INV-2) — `defineJob` rejects a schema with a
  string field not named `*Id`/`*Key` unless whitelisted (documented in the inventory fragment).
- pg-boss in schema `pgboss`, polling mode (works through Neon's pooler), started lazily by `getQueue()`.
- `worker.server.ts`: globs `app/features/*/jobs.server.ts`, registers each exported job, graceful shutdown
  on SIGTERM (finish in-flight, stop polling).
- Failed jobs after the retry limit go to a dead-letter queue name `<name>.dead`.

## Explicit non-scope

- Any concrete job → specs 23, 25, 30.

## Reuse first

- Named in detail: `app/shared/config.server.ts` (`DIRECT_URL`/`DATABASE_URL`), `../docs/research/libraries.md` (pg-boss)
- pg-boss built-ins for retry, backoff, singleton keys and dead letter — do not hand-roll a retry loop.

## Wiring

Real, used now: pg-boss on `TEST_DATABASE_URL` in tests. Stubbed: none. Consumers: 23, 25, 30.

## Examples

| Case | Expected | Why this row |
| --- | --- | --- |
| enqueue twice with the same `singletonKey` | one job | INV-8 dedupe |
| handler throws twice, retryLimit 3 | runs 3 times, succeeds | retry |
| handler always throws | lands in `<name>.dead` after limit | dead letter |
| payload schema with field `rxText: string` | `defineJob` throws at registration | INV-2 |
| SIGTERM during a job | job completes, worker exits 0 | shutdown |

## Steps

1. Queue wrapper + `defineJob`; 2. worker discovery + shutdown; 3. every Examples row a test on a real DB.

## Self-check

1. Discovery test uses a fixture `jobs.server.ts` under a test features folder, not a mock of the glob.
2. Payload validated on receive too (a job enqueued by an older version still parses or fails loudly).

## Done when

- [x] `pnpm vitest run app/shared/queue app/worker.server.test.ts` passes: every Examples row is a case. [unit]
- [x] INV-2: the `defineJob` guard test above passes. [unit]
- [x] INV-8: the singleton-key test proves one job for a duplicate enqueue. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/08-job-queue.md` lists `getQueue`, `defineJob`, the jobs discovery contract. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-07** — Spec 08 completed by agy-4 (engine agy, model gemini-3.8-flash):
  - Picked up existing work from opencode runs; resolved generic typing variance between `JobDefinition` and `AnyJobDefinition` to fix typecheck failures without any lint-disables or type-ignores.
  - Reverted `vitest.config.ts` environment leak that broke config tests; DB-backed tests use `TEST_DATABASE_URL` directly.
  - Implemented typed `Queue` wrapper with lazy `getQueue()` singleton in schema `pgboss` using polling mode (safe for connection poolers).
  - Implemented `defineJob` enforcing INV-2 payload shape restrictions: string fields must end in `Id`/`Ids`/`Key`/`Keys` unless listed in `allowStringFields`; object schemas must not be passthrough or have arbitrary catchalls. Payloads validated both on enqueue and on receive (stale/invalid payloads fail loudly to dead-letter queue `<name>.dead`).
  - Worker process (`worker.server.ts` / `runWorker`) implements feature job discovery (`app/features/*/jobs.server.ts`) via `discoverJobs` and web registration via eager glob (`registerWebFeatureJobs`). Gracefully shuts down in-flight work on SIGTERM.
  - Verified Examples cases with unit/integration tests on real Postgres: singleton-key deduplication (INV-8), retry policy with success, exhaustion to dead-letter queue (`<name>.dead`), INV-2 registration rejection of `rxText`, and SIGTERM in-flight job drain.
  - Self-check:
    1. Discovery test loads fixture `jobs.server.ts` under test features directory (`app/shared/queue/__fixtures__/features/slow/jobs.server.ts`), not a mock: checked, holds.
    2. Payload validated on receive too: checked, holds (`Queue.work` validates via `validateJobPayload` and routes failures to dead-letter queue).
  - Sabotage:
    - Sabotage INV-2 guard in `defineJob` (`assertPayloadSchema` bypassed): 3 tests in `define-job.test.ts` failed as expected (red), restored.
    - Sabotage INV-8 dedupe policy (`"exclusive"` switched to `"standard"`): singleton test failed with non-null duplicate enqueue (red), restored.
  - Documented reusable interfaces in `specs/inventory/08-job-queue.md` (`getQueue`, `defineJob`, jobs discovery contract).
  - Gates: `pnpm typecheck` passed (0 errors); `pnpm lint` passed (0 errors, 0 warnings); `pnpm vitest run app/shared/queue app/worker.server.test.ts` passed (4 files, 15 tests); `pnpm test` passed (9 files, 38 tests, 0 failures); `pnpm build` passed.
- **2026-11-08** — Evidence (orchestro spec verify, tree 9ba21ab6): install pass · typecheck pass · lint pass · build pass · test pass 70/0/0
