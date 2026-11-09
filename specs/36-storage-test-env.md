# Spec 36 — Storage test process.env isolation

**Status:** Not started
**Depends on:** Spec 34
**Model:** Light — `claude-haiku-5-5` · `gpt-6-luna` · `gemini-3.5-flash-lite`
**Issue:** —
**Owns:** `app/shared/storage/object-store.server.test.ts`
**Reuses:** `ARCHITECTURE.md` (structural invariant 2), `specs/01-scaffold.md`
**Kind:** bugfix
**Invariants:** —

## Goal

Resolve the Spec 01 Done-when gate failure by replacing literal `process.env` mutations in `app/shared/storage/object-store.server.test.ts` with Vitest's `vi.stubEnv` and `vi.unstubAllEnvs()` so that `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` passes with 0 hits.

## Scope

- In `app/shared/storage/object-store.server.test.ts` lines 577–608, replace `delete process.env.X` and `process.env.X = ...` with `vi.stubEnv(...)` and `vi.unstubAllEnvs()`.
- Verify the strict gate command `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` finds 0 hits.
- Verify unit tests in `app/shared/storage/object-store.server.test.ts` pass cleanly.

## Explicit non-scope

- Changes to `app/shared/config.server.ts` or production configuration handling.
- Modifying S3 adapter production logic in `app/shared/storage/object-store.server.ts`.
- Changes to any other test files.

## Reuse first

- Vitest environment stubbing APIs: `vi.stubEnv`, `vi.unstubAllEnvs`.

## Wiring

Real, used now: unit test suite. In tests: stubbed env variables. Stubbed: none. Consumers: none.

## Examples

| Current test code | Required replacement |
|---|---|
| `delete process.env.S3_BUCKET;` | `vi.stubEnv("S3_BUCKET", undefined as unknown as string);` or cleanup hook |
| `process.env.S3_BUCKET = "my-configured-bucket";` | `vi.stubEnv("S3_BUCKET", "my-configured-bucket");` |

## Steps

1. In `app/shared/storage/object-store.server.test.ts`, refactor the lazy S3 client test block to use `vi.stubEnv` and `vi.unstubAllEnvs()`.
2. Run `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` to verify 0 occurrences.
3. Run `pnpm vitest run app/shared/storage/object-store.server.test.ts` to ensure tests continue to pass.
4. Run `pnpm typecheck` and `pnpm lint`.

## Self-check

1. `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` outputs nothing.
2. `app/shared/storage/object-store.server.test.ts` passes.

## Done when

- [x] `app/shared/storage/object-store.server.test.ts` uses `vi.stubEnv` / `vi.unstubAllEnvs()`; `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` finds nothing. [static]
- [x] `pnpm vitest run app/shared/storage/object-store.server.test.ts` passes with 0 failures. [unit]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]

## Log

- **2026-11-09** — Replaced direct `process.env` mutations in `app/shared/storage/object-store.server.test.ts` with `vi.stubEnv` and `vi.unstubAllEnvs()` in `afterEach`.
  - Self-check:
    - `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'`: 0 matches (exit 1).
    - `app/shared/storage/object-store.server.test.ts`: 27 tests passed.
  - Gates:
    - `pnpm typecheck`: exit 0 (0 errors across 3 workspace projects).
    - `pnpm lint`: exit 0 (0 errors, 0 warnings).
    - `pnpm vitest run app/shared/storage/object-store.server.test.ts`: 1 test file passed, 27 tests passed, 0 failures.
    - `pnpm test`: 75 test files passed, 1353 tests passed, 0 failures.
    - `pnpm build`: exit 0.
- **2026-11-09** — Corrected invariant header to `—` (removing false INV-2 claim) while retaining ARCHITECTURE structural invariant 2 reference (R3-F3).
- **2026-11-09** — Spec created to address Spec 01 process.env gate violation in storage tests (R2-F1, R2-F6).
- **2026-11-09** — Evidence (orchestro spec verify, tree ab019c79): install pass · typecheck pass · lint pass · build pass · test pass 1353/0/0
