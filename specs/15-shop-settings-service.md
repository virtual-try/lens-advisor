# Spec 15 — Shop settings repository and service

**Status:** Not started
**Depends on:** Spec 02, Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/features/settings/settings.repository.server.ts`, `app/features/settings/settings.service.server.ts`, `app/features/settings/settings.server.test.ts`, `app/features/settings/schema.ts`, `specs/inventory/15-shop-settings-service.md`
**Reuses:** `prisma/schema.prisma` (spec 02), `test/db.ts` (spec 02)
**Kind:** storage
**Invariants:** INV-1, INV-3

## Goal

Read and write each shop's settings with safe defaults, so the configurator, the order pipeline and the
admin read one source.

## Scope

- Fields: `labEmail` (one or more addresses), `ticketFormat` (`PDF` | `CSV` | `BOTH`, default `PDF`),
  `storeRxInOrder` (default **false**, INV-3), `rxUploadEnabled` (default true), `manualRxEnabled`
  (default true; at least one of the two must stay on).
- `getSettings(shopId)` returns defaults when no row exists (no write on read).
- `updateSettings(shopId, patch)` validates via `schema.ts`; emails validated; partial patch merges.
- `isSetupComplete(shopId)` → `{ labEmail: bool }` used by spec 31.

## Explicit non-scope

- Admin form → spec 20. Billing plan → spec 09.

## Reuse first

- Named in detail: Prisma model `ShopSettings` (spec 02)
- Prisma client from the container (spec 01).

## Wiring

Real, used now: Prisma (02). Stubbed: none. Consumers: 20, 21, 30, 31.

## Examples

| Operation | Expected | Why this row |
| --- | --- | --- |
| get with no row | defaults, `storeRxInOrder=false` | default |
| patch `{ticketFormat: "CSV"}` | other fields unchanged | partial merge |
| patch both Rx inputs off | `ValidationError AT_LEAST_ONE_RX_INPUT` | invalid |
| `labEmail: "lab@x"` | `ValidationError EMAIL` | invalid |
| shop B reads | gets B's defaults, never A's row | INV-1 |

## Steps

1. Repository + service; 2. every Examples row a test.

## Self-check

1. Reading never inserts (a GET must not write).
2. Default for `storeRxInOrder` is false everywhere, including the Prisma default (INV-3).
3. Storage checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/settings` passes: every Examples row is a case. [unit]
- [ ] INV-1: a test seeds shops A and B and asserts reads and writes stay in their shop. [unit]
- [ ] INV-3: a test asserts a fresh shop reads `storeRxInOrder=false`. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/15-shop-settings-service.md` lists the service functions. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
