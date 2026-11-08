# Spec 35 — Fix verification findings

**Status:** Not started
**Depends on:** Spec 34
**Model:** Light — `claude-haiku-5-5` · `gpt-6-luna` · `gemini-3.5-flash-lite`
**Issue:** —
**Owns:** `packages/configurator/src/steps/02-prescription/prescription.css`, `app/shared/storage/object-store.server.test.ts`
**Reuses:** `DESIGN-SYSTEM.md`, `INVARIANTS.md`, `ARCHITECTURE.md`
**Kind:** bugfix
**Invariants:** INV-7

## Goal

Resolve the two findings identified by the Spec 34 verification pass:
1. Replace the non-existent token `--la-radius-full` in `prescription.css` with the canonical design system token `--la-radius-pill`.
2. Replace literal `process.env` mutations in `object-store.server.test.ts` with `vi.stubEnv` / `vi.unstubAllEnvs` to satisfy the strict repository invariant that no literal `process.env` appears outside `app/shared/config.server.ts`.

## Scope

- In `packages/configurator/src/steps/02-prescription/prescription.css:408`, update `border-radius: var(--la-radius-full);` on `.la-progress` to `border-radius: var(--la-radius-pill);`.
- In `app/shared/storage/object-store.server.test.ts` lines 577–608, replace `delete process.env.X` and `process.env.X = ...` with `vi.stubEnv` and `vi.unstubAllEnvs()`.
- Rebuild configurator bundle and verify all checks pass.

## Explicit non-scope

- Introducing new tokens into `DESIGN-SYSTEM.md`.
- Database schema changes or migrations.
- Changes to production application code outside the scoped CSS token fix in `packages/configurator/src/steps/02-prescription/prescription.css`.
- New features or unrelated refactoring.

## Steps

1. In `packages/configurator/src/steps/02-prescription/prescription.css`, replace `--la-radius-full` with `--la-radius-pill`.
2. In `app/shared/storage/object-store.server.test.ts`, refactor the lazy S3 client test block to use `vi.stubEnv` and `vi.unstubAllEnvs()`.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `pnpm test:e2e`.

## Done when

- [ ] `packages/configurator/src/steps/02-prescription/prescription.css` uses `--la-radius-pill`; `rg "radius-full" packages/configurator/` returns 0 hits. [static]
- [ ] `app/shared/storage/object-store.server.test.ts` uses `vi.stubEnv` / `vi.unstubAllEnvs()`; `rg "process\.env" app/ packages/` returns hits only in `app/shared/config.server.ts`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
- [ ] `pnpm test` and `pnpm test:e2e` pass with 0 failures. [suite]

## Log

- **2026-11-09** — Spec created to address findings identified during Spec 34 verification pass.
