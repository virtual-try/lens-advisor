# Spec 02 — Database schema and first migration

**Status:** Not started
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

- [ ] `pnpm vitest run test/db.test.ts` passes: two `createTestDb()` calls get isolated schemas; deleting a `Shop` cascades to a seeded row in every shop-owned table. [unit]
- [ ] INV-1: a test reads the Prisma DMMF and asserts every model except `Shop`/`Session` has a required `shopId` with an index leading with it. [unit]
- [ ] INV-2: a DMMF test asserts `Prescription` has no field named for an Rx value (sph, cyl, axis, add, pd). [unit]
- [ ] INV-4 / INV-5: a DMMF test asserts no `Float` or `Decimal` field exists in the schema. [unit]
- [ ] INV-10: the cascade test above covers every shop-owned model, enumerated from the DMMF, not a hand list. [unit]
- [ ] `prisma migrate deploy` applies cleanly to a fresh database. [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/02-database-schema.md` lists the models and `createTestDb`/`seedShop`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
