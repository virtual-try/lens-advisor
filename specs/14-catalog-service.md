# Spec 14 — Catalog repository and service

**Status:** Not started
**Depends on:** Spec 02, Spec 03
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/features/catalog/catalog.repository.server.ts`, `app/features/catalog/catalog.repository.server.test.ts`, `app/features/catalog/catalog.service.server.ts`, `app/features/catalog/catalog.service.server.test.ts`, `app/features/catalog/schema.ts`, `specs/inventory/14-catalog-service.md`
**Reuses:** `prisma/schema.prisma` (spec 02), `test/db.ts` (spec 02), `packages/rx-core/src/schemas/` (spec 03)
**Kind:** storage, api
**Invariants:** INV-1, INV-4, INV-5

## Goal

CRUD for the merchant's lens catalog — groups, lenses with Rx limits, option groups and values, add-ons —
plus `getStorefrontCatalog(shopId)` that returns exactly the DTO the configurator consumes.

## Scope

- Repository (Prisma, injected client): list/get/create/update/delete/reorder per entity, every function
  taking `shopId` first (INV-1). Soft-delete via `archivedAt` so old orders keep referencing rows.
- Service: validates input with `schema.ts` (admin form shapes), enforces `sphMin ≤ sphMax`, `cylMin ≤
  cylMax`, prices ≥ 0, unique names within a group; maps rows → spec 03 DTOs.
- `getStorefrontCatalog(shopId)` excludes archived rows and rows without a Shopify variant id (not yet
  synced by spec 17) — they are not purchasable.
- `markSynced(shopId, entity, id, variantId)` — the only write path spec 17 uses.

## Explicit non-scope

- Shopify product/variant creation → spec 17.
- Admin screens → specs 18, 19. Storefront endpoint → spec 21.
- Lab-code template validation → spec 18 calls spec 12.

## Reuse first

- Named in detail: Prisma models `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn` (spec 02); catalog DTO schemas (spec 03); `validateTemplate` is NOT a dependency (admin form calls it, spec 18)
- Spec 03 DTO schemas for output; do not define a second `Lens` type.
- Prisma client from the container (spec 01); never `new PrismaClient()` here.

## Wiring

Real, used now: Prisma (02), DTO schemas (03). Tests: a Postgres test database per `ARCHITECTURE.md#test-data`.
Stubbed: none. Consumers: 17, 18, 19, 21, 31.

## Examples

| Operation | Expected | Why this row |
| --- | --- | --- |
| create lens SPH −800..+600 | saved; DTO limits `-800/600` | normal |
| create lens sphMin 600, sphMax −800 | `ValidationError LIMITS_INVERTED` | invalid |
| price `-1` | `ValidationError NEGATIVE_PRICE` | invalid |
| archive lens; `getStorefrontCatalog` | lens absent; `getLens` still returns it | soft delete |
| lens without variant id | absent from storefront catalog | unsynced |
| shop B calls `updateLens` with shop A's id | `NotFoundError`, row unchanged | INV-1 |

## Steps

1. Repository + tests against the test DB; 2. service + mapping; 3. every Examples row a test.

## Self-check

1. Every query has `shopId` in its `where` — including update/delete by id (INV-1).
2. Reorder is one transaction; a failure leaves the old order.
3. Storage + api checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/catalog` passes: every Examples row is a case; reorder interrupted mid-transaction leaves the previous order. [unit]
- [ ] INV-1: for every repository function, a test seeds shops A and B and asserts B's rows are absent/untouched. [unit]
- [ ] INV-4: prices round-trip as integers; a float input is rejected by `schema.ts`. [unit]
- [ ] INV-5: limits round-trip as integer hundredths. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/14-catalog-service.md` lists the repository and service functions. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
