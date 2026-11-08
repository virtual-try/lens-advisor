# Spec 35 — Fix: Web feature jobs glob fallback outside Vite and queue test seam

**Status:** Not started
**Depends on:** Spec 08, Spec 33
**Model:** Light — `claude-haiku-4-5` · `gpt-5-mini` · `gemini-2.5-flash`
**Issue:** —
**Owns:** `app/shared/queue/web-definitions.server.ts`, `app/shared/container/queue.server.ts`
**Reuses:** `app/shared/queue/discovery.server.ts`, `app/shared/config.server.ts`
**Kind:** bugfix
**Invariants:** INV-1, INV-8

## Goal

`app/shared/queue/web-definitions.server.ts` unconditionally calls `import.meta.glob<Record<string, unknown>>("../../features/*/jobs.server.ts", { eager: true })`. While this works when bundled by Vite (client and production server builds), in runtime environments executing outside Vite (such as Node.js in-process Playwright e2e test harnesses or CLI scripts), `import.meta.glob` is undefined and throws `TypeError: (intermediate value).glob is not a function`.

Furthermore, once definitions load, route handlers calling `getQueue()` initialize a pg-boss instance using `getConfig().database.databaseUrl` (`DATABASE_URL`), which in e2e environments targets a dev database rather than `TEST_DATABASE_URL` (where the test schema and tables exist), and there is no test seam to inject a fake queue or override the connection.

Fix both issues by:
1. Providing a typed check for `import.meta.glob` without `any` and an explicit non-Vite fallback list of job definitions.
2. Providing a queue test seam (such as `(globalThis as Record<string, unknown>).__queue` or `setQueueForTest` / `resetQueueForTest`) and ensuring pg-boss under e2e and test execution uses `TEST_DATABASE_URL`, never `DATABASE_URL`.

## Scope

- In `app/shared/queue/web-definitions.server.ts`, detect Vite glob support using a typed check with a narrow cast (no `any`):
  `typeof (import.meta as { glob?: unknown }).glob === "function"`.
- If `import.meta.glob` is available (Vite build), use it as before.
- If unavailable (plain Node / tsx / Playwright runtime), load an explicit static list of feature job definition modules (e.g. `import("../../features/lab-dispatch/jobs.server.js")`) or fall back to filesystem discovery (`discovery.server.ts`), registering them with `defineJob`.
- In `app/shared/container/queue.server.ts`, provide a queue test seam:
  - Check for global test injection (e.g. `(globalThis as Record<string, unknown>).__queue`) or exported `setQueueForTest(queue: Queue | undefined)`.
  - When constructing `createPgBoss` in test/e2e environments (`NODE_ENV === "test"` or `process.env.TEST_DATABASE_URL`), point the connection string at `process.env.TEST_DATABASE_URL`, never `DATABASE_URL`, and use the appropriate test schema.
- Un-annotate Flows 11 & 12 in `e2e/server/orders.spec.ts` and the compliance `shop/redact` webhook test at `e2e/server/compliance.spec.ts:151` from `test.fixme` and ensure they pass end-to-end.

## Explicit non-scope

- Does not alter job payload schemas, validation, or handler logic in `app/features/lab-dispatch/jobs.server.ts`.
- Does not change worker process discovery (`app/shared/queue/discovery.server.ts`) or the worker entry point (`app/worker.server.ts`).
- Does not disable or weaken TypeScript strictness rules (specifically `no-explicit-any` must remain strictly enabled with 0 warnings).

## Reuse first

- Reuses `getJobDefinitions()` and `defineJob` from `app/shared/queue/define-job.ts`.
- Reuses `createQueue` and `Queue` interface from `app/shared/queue/queue.ts`.
- Reuses test database utilities from `test/db.ts` (`TEST_DATABASE_URL`).

## Wiring

- `web-definitions.server.ts` is called by `getQueue()` in `app/shared/container/queue.server.ts`.
- `getQueue()` is consumed by route actions: `app/routes/webhooks.orders.create.tsx` and `app/routes/app.lab-orders.$id.tsx`.
- Tests in `e2e/server/orders.spec.ts` inject or interact with the queue via the seam.

## Examples

| Runtime environment | `import.meta.glob` check | Action taken | Result |
| --- | --- | --- | --- |
| Vite build (SSR / prod) | `typeof ... === "function"` | Executes `import.meta.glob` eagerly | Feature jobs registered |
| Plain Node / Playwright e2e | `typeof ... !== "function"` | Loads explicit fallback definition list | Feature jobs registered without error |
| e2e with injected queue seam | Global/seam override present | `getQueue()` returns injected queue | Enqueued jobs captured in test without dev DB |

## Steps

1. Update `app/shared/queue/web-definitions.server.ts` with typed check and explicit fallback definition list.
2. Update `app/shared/container/queue.server.ts` with queue test seam and `TEST_DATABASE_URL` routing under test environment.
3. Un-annotate Flows 11 and 12 in `e2e/server/orders.spec.ts` and the compliance `shop/redact` webhook test in `e2e/server/compliance.spec.ts:151`, verify full pass.
4. Run static gates (`typecheck`, `lint`, `build`).

## Self-check

1. `no-explicit-any`: No `any` casts used in `web-definitions.server.ts` or `queue.server.ts`.
2. DB isolation: Under `NODE_ENV === "test"`, `DATABASE_URL` is never contacted by pg-boss.

## Done when

- [ ] `web-definitions.server.ts` executes in plain Node/Playwright without throwing `TypeError: (intermediate value).glob is not a function`. [unit]
- [ ] `getQueue()` provides a test seam and uses `TEST_DATABASE_URL` in test environments, never touching dev `DATABASE_URL`. [unit]
- [ ] Spec 33 Flows 11 & 12 in `e2e/server/orders.spec.ts` can be un-annotated from `fixme` and pass. [e2e]
- [ ] Spec 33 compliance `shop/redact` webhook test at `e2e/server/compliance.spec.ts:151` can be un-annotated from `fixme` and pass. [e2e]
- [ ] Flow 11 and 12 bodies consume captured queue jobs. [e2e]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 35 created to address app bug triaged during spec 33 e2e run (`import.meta.glob` failure outside Vite bundler).
- **2026-11-08** — Expanded spec 35 with full template, typed glob check (no `any`), explicit non-Vite fallback list, queue test seam, and `TEST_DATABASE_URL` guarantee per Review R1 findings R1-F2 and R1-F3.
- **2026-11-09** — Updated Scope, Steps, and Done when to include un-annotating compliance `shop/redact` webhook test in `e2e/server/compliance.spec.ts:151` per Review R3 finding R3-F5.
