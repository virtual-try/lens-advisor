# Spec 02 — Database schema and first migration

**Status:** Done
**Depends on:** Spec 01
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `prisma/schema.prisma`, `prisma/migrations/`, `test/db.ts`, `test/db.test.ts`, `specs/inventory/02-database-schema.md`
**Reuses:** `ARCHITECTURE.md#data-model`, `app/shared/container/prisma.server.ts` (spec 01)
**Kind:** storage
**Invariants:** INV-1, INV-2, INV-4, INV-5, INV-10

## Goal

Every MVP table in one migration, exactly as `ARCHITECTURE.md#data-model` lists, plus the test-database
helper every DB-backed test uses.

## Scope

- Models: `Shop`, `ShopSettings`, `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`,
  `Prescription`, `LabOrder`, `ComplianceRequest` (template `Session` untouched).
- Every model except `Shop` and `Session` has `shopId` (FK → `Shop`, `onDelete: Cascade`) and an index
  leading with `shopId`. Composite uniques per the data model (`LabOrder` shop+order+bundle).
- Money: `Int` minor units + `currency` `String(3)`. Diopters: `Int`. `Prescription.cipher` is `Text`; no
  plaintext Rx column exists anywhere.
- `ShopSettings.storeRxInOrder` default `false`.
- `test/db.ts`: `createTestDb()` → creates schema `t_<random>` on `TEST_DATABASE_URL`, runs
  `prisma migrate deploy` against it, returns a Prisma client and a `drop()`; `seedShop(db, domain)` fixture.

## Explicit non-scope

- Repositories → specs 14, 15, 22, 23. pg-boss tables → spec 08 (own schema).
- Encryption of the cipher column → spec 05 (this column only stores the token).

## Reuse first

- Named in detail: `ARCHITECTURE.md#data-model`, `getPrisma` (spec 01)
- Template `Session` model and Prisma session storage — keep as is.

## Wiring

Real, used now: Prisma, `TEST_DATABASE_URL`. Stubbed: none.

## Steps

1. Write the models; `prisma migrate dev --name init` against a local DB; commit the migration.
2. `test/db.ts` + its tests.

## Self-check

1. Every shop-owned model has `shopId` + cascade — the INV-10 redaction test (spec 25) will enumerate them.
2. No `Float`/`Decimal` on money or diopter fields.
3. Storage checklist (`spec-quality.md` §8): migration applies to an empty DB and to a DB holding template sessions.

## Done when

- [x] `pnpm vitest run test/db.test.ts` passes: two `createTestDb()` calls get isolated schemas; deleting a `Shop` cascades to a seeded row in every shop-owned table. [unit]
- [x] INV-1: a test reads the Prisma DMMF and asserts every model except `Shop`/`Session` has a required `shopId` with an index leading with it. [unit]
- [x] INV-2: a DMMF test asserts `Prescription` has no field named for an Rx value (sph, cyl, axis, add, pd). [unit]
- [x] INV-4 / INV-5: a DMMF test asserts no `Float` or `Decimal` field exists in the schema. [unit]
- [x] INV-10: the cascade test above covers every shop-owned model, enumerated from the DMMF, not a hand list. [unit]
- [x] `prisma migrate deploy` applies cleanly to a fresh database. [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/02-database-schema.md` lists the models and `createTestDb`/`seedShop`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-07** — Spec 02 implemented. Migration left uncommitted; the lead commits (this run does no git writes).
  - Models in `prisma/schema.prisma`: `Shop`, `ShopSettings`, `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`, `Prescription`, `LabOrder`, `ComplianceRequest`. Template `Session` fields are unchanged. One migration: `prisma/migrations/20261107120000_init/migration.sql`, produced by `prisma migrate diff --from-empty`, with `CREATE TABLE "Session"` changed to `CREATE TABLE IF NOT EXISTS` so a schema that already holds the template Session table keeps its rows.
  - Money is `Int` (`priceMinor`, `priceDeltaMinor`) plus `currency` `VarChar(3)`. Diopters are `Int` (`sphMin`/`sphMax`, `cylMin`/`cylMax`, optional `addMin`/`addMax`). `Prescription.cipher` is `Text`. No plaintext Rx column. `ShopSettings.storeRxInOrder` defaults to false.
  - Every model except `Shop` and `Session` has required `shopId` → `Shop` `onDelete: Cascade`. `ShopSettings.shopId` is the primary key. `LabOrder` uses `@@unique([shopId, shopifyOrderId, bundleId])`. The other shop-owned models use `@@unique([shopId, id])`. Decision: Prisma Client 6.19 `Prisma.dmmf` omits non-unique `@@index` and leaves `primaryKey` null, and the INV-1 test has to read that DMMF. `(shopId, id)` rejects no row the primary key would not already reject. `Lens.groupId`, `OptionValue.optionGroupId`, and `LabOrder.lensId` are Cascade so one `Shop` delete removes every shop-owned row. `LabOrder.prescriptionId` is `onDelete: SetNull` so spec 25 can delete a prescription and keep the lab order.
  - `test/db.ts`: `createTestDb()` creates schema `t_<16 hex>` on `TEST_DATABASE_URL`, runs `prisma migrate deploy`, and returns a client plus `drop()`. `seedShop(db, domain)` inserts one fixture row in every shop-owned table. `vitest.config.ts` gained a `db` project so `pnpm test` runs `test/**/*.test.ts`. `tsconfig.json` includes `test/**/*.ts` so `pnpm typecheck` covers those files.
  - Self-check 1: holds. The DMMF test asserts required `shopId`, `onDelete: Cascade`, and a shop-leading unique index on every model except `Shop` and `Session`. The cascade test deletes one `Shop`; every shop-owned model enumerated from the DMMF goes to 0 rows, and the template `Session` row stays. Sabotage: `AddOn` shop FK flipped from `ON DELETE CASCADE` to `RESTRICT` in the migration → red, `Foreign key constraint violated on the constraint: AddOn_shopId_fkey`. Restored to `CASCADE` before the final suite.
  - Self-check 2: holds. The DMMF test finds no `Float` or `Decimal` field. `*Minor` fields are `Int`. Diopter min/max fields are `Int`.
  - Self-check 3: holds. The same test applies `migrate deploy` to an empty schema and to a schema that already contains a template Session row; the row is still there and `Shop` exists. Prisma returns P3005 when that schema has tables but no `_prisma_migrations` table, so the test creates an empty migrations table first and does not mark the migration applied; deploy then runs the SQL. `prisma migrate diff --from-url <fresh schema> --to-schema-datamodel prisma/schema.prisma --exit-code` printed `No difference detected`.
  - Gates, after the last source change (`pnpm test` before the `tsconfig.json` include; `pnpm typecheck` again after it): `pnpm test` → `Test Files  6 passed (6)` / `Tests  29 passed (29)`, including `✓ |db| test/db.test.ts (6 tests)`. `pnpm lint` (`eslint . --max-warnings 0`) exited 0 and printed no findings. `pnpm typecheck` exited 0. `pnpm build` exited 0.
- **2026-11-07** — Evidence (orchestro spec verify, tree d8f16919): install pass · typecheck pass · lint pass · build pass · test pass 183/0/0
- **2026-11-07** — Review fixes R1-F2, R1-F3, R1-F4, R1-F5, R1-F6. The earlier self-check that created `_prisma_migrations` by hand is withdrawn.
  - **Production upgrade (R1-F2).** A database left by spec 01 has the template `Session` table (from `prisma db push` of that model) and no `_prisma_migrations` table. `prisma migrate deploy` on that database stops with P3005. The supported upgrade is two commands, in order:

    ```
    prisma migrate resolve --applied 20261107000000_session_baseline
    prisma migrate deploy
    ```

    `resolve --applied` records `prisma/migrations/20261107000000_session_baseline` (the `Session` table only) as already applied and creates `_prisma_migrations` itself. It does not run that SQL, so the template rows stay. `migrate deploy` then applies `20261107120000_init`. A fresh database skips `resolve` and runs `prisma migrate deploy` alone, which applies the baseline and then init. The upgrade test builds that template database with `db push` of the `Session` model and runs those two commands. It does not insert into `_prisma_migrations`.
  - **R1-F3.** `OptionValue.currency` is a required `String` `@db.VarChar(3)` beside `priceDeltaMinor`. The DMMF test requires every `*Minor` field to have that sibling.
  - **R1-F4.** `20261107120000_init/migration.sql` opens with `BEGIN` and ends with `COMMIT`, so a failed statement rolls the init migration back instead of leaving a partial schema.
  - **R1-F5.** The INV-2 test asserts `Prescription`'s exact scalar columns: `id`, `shopId`, `rxType`, `source`, `cipher`, `uploadKeys`, `createdAt`, `orderId`.
  - **R1-F6.** The init migration file no longer ends with a blank line.
