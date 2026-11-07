# Spec 15 — Shop settings repository and service

**Status:** Done
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

- [x] `pnpm vitest run app/features/settings` passes: every Examples row is a case. [unit]
- [x] INV-1: a test seeds shops A and B and asserts reads and writes stay in their shop. [unit]
- [x] INV-3: a test asserts a fresh shop reads `storeRxInOrder=false`. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/15-shop-settings-service.md` lists the service functions. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 15 implemented by grok in worktree `spec-15` (branch `spec/15-shop-settings-service`). No git writes (lead commits). GitHub issue skipped: this dispatch forbids git writes and opening a PR.
- **2026-11-08** — Landed `app/features/settings/schema.ts`, `settings.repository.server.ts`, `settings.service.server.ts`, `settings.server.test.ts`, and `specs/inventory/15-shop-settings-service.md`. No Prisma schema change: `ShopSettings` and `storeRxInOrder @default(false)` stay as spec 02 left them.
- **2026-11-08** — Decisions: (1) The service field is `labEmail` (one string or a string array on input, a string array on output). The Prisma column stays `labEmails`. A patch key `labEmails` is `ValidationError INVALID` and writes nothing. (2) Addresses are trimmed, lowercased, and de-duplicated. Zod's email check rejects `lab@x` and blank text. Max length 254. A comma-separated string is not split. An empty list is valid and means setup is incomplete. (3) `ValidationError` extends `BadRequestError` (400) with codes `EMAIL`, `AT_LEAST_ONE_RX_INPUT`, and `INVALID`. (4) `getSettings` and `isSetupComplete` only `findUnique`. No row returns defaults and inserts nothing. `isComplete` is the same function as `isSetupComplete` because spec 31 names it that way. The result is `{ labEmail: boolean }`, not a bare boolean. (5) `updateSettings` merges a partial patch, then requires at least one of `rxUploadEnabled` and `manualRxEnabled`. The shop row is locked with `SELECT … FOR UPDATE` and the upsert runs in that transaction. A missing shop throws `NotFoundError` and writes nothing. (6) The optional last `db` argument defaults to `getPrisma()`. Tests pass the `createTestDb()` client. This feature does not construct a `PrismaClient`. `seedShop` always inserts settings, so these tests create the shop themselves. (7) A stored row with an invalid address or both prescription inputs off throws `InternalServerError` `CORRUPT_SETTINGS` on read and is not merged into a partial patch. A patch that sets every field replaces that row. (8) `storeRxInOrder: "true"` is `INVALID`, not coerced.
- **2026-11-08** — Self-check 1: holds. A get and an `isSetupComplete` on a shop with no settings row leave `shopSettings` and `shop` counts unchanged, and `findUnique` stays null. Sabotage: `getSettings` created a row on a miss → red, `expected { …(6) } to be null`. Restored.
- **2026-11-08** — Self-check 2: holds. A fresh shop reads `storeRxInOrder` false. A row created without that column stores false. Prisma DMMF `ShopSettings.storeRxInOrder.default` is `false`. Sabotage: in-code default flipped to true → red, `expected true to be false`. Restored.
- **2026-11-08** — Self-check 3: storage checklist holds. The write is one transaction and one upsert. A patch that fails validation leaves the previous row, or leaves no row when none existed. `upsertShopSettings` inside a transaction that then throws `"crash"` leaves the previous email, `PDF`, and `storeRxInOrder` false. A corrupt row is reported and not returned. A partial patch does not rewrite it. No migration in this spec. A `{ ticketFormat: "CSV" }` patch keeps the saved lab email, privacy flag, and prescription-input flags.
- **2026-11-08** — Sabotage, then restored: `findShopSettings` used `findFirst` with no `shopId` → shop B read `alpha@example.com`, `CSV`, and `storeRxInOrder` true. `isLabEmail` returned true for every address → the `lab@x` case got `CORRUPT_SETTINGS` instead of `ValidationError EMAIL` (the read-back rejected the write and the transaction rolled it back).
- **2026-11-08** — Gates after the last code change:
  - `pnpm exec vitest run app/features/settings` → `Test Files  1 passed (1)` / `Tests  10 passed (10)`
  - `pnpm test` → `Test Files  18 passed (18)` / `Tests  289 passed (289)`
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm build` exit 0
- **2026-11-07** — Evidence (orchestro spec verify, tree 9a2d0a6b): install pass · typecheck pass · lint pass · build pass · test pass 340/0/0
