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

- [x] `pnpm vitest run app/features/catalog` passes: every Examples row is a case; reorder interrupted mid-transaction leaves the previous order. [unit]
- [x] INV-1: for every repository function, a test seeds shops A and B and asserts B's rows are absent/untouched. [unit]
- [x] INV-4: prices round-trip as integers; a float input is rejected by `schema.ts`. [unit]
- [x] INV-5: limits round-trip as integer hundredths. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/14-catalog-service.md` lists the repository and service functions. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 14 implemented. No git writes (lead commits).
  - Repository `app/features/catalog/catalog.repository.server.ts`: Implemented `createCatalogRepository(prisma)` and `CatalogRepository` class plus standalone repository functions for all entities (`LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`). Every function accepts `shopId` first and includes `shopId` in its Prisma `where` clause (INV-1). Single-row lookups and updates target compound unique index `shopId_id: { shopId, id }`. Reorder executes in a single `$transaction`, verifying that all IDs belong to `shopId` before updating positions; soft deletes set `archivedAt: new Date()`.
  - Schema `app/features/catalog/schema.ts`: Zod schemas for input validation and updates (`lensGroupInputSchema`, `lensInputSchema`, `optionGroupInputSchema`, `optionValueInputSchema`, `addOnInputSchema`, `reorderSchema`). Enforces integer minor units for money (INV-4) and integer hundredths for diopters (INV-5), non-negative prices (`NEGATIVE_PRICE`), limit consistency `sphMin <= sphMax`, `cylMin <= cylMax`, `addMin <= addMax` (`LIMITS_INVERTED`), and option value exclusivity between tokens and override codes (`ONE_CODE_SOURCE`).
  - Service `app/features/catalog/catalog.service.server.ts`: Implemented `createCatalogService(deps)` and `CatalogService` class plus standalone service functions. Validates inputs through `schema.ts`, enforces unique names within groups/shops among active entities (`NAME_NOT_UNIQUE`), maps rows to spec 03 DTOs without leaking raw Prisma models or floats past the boundary, and provides `getStorefrontCatalog(shopId)` returning validated `CatalogResponse` excluding archived rows, un-synced lenses/add-ons without variant IDs, and unsynced priced options.
  - Inventory fragment `specs/inventory/14-catalog-service.md`: Created, documenting all repository and service functions, error classes, schemas, and DTO types.
  - Self-check 1: checked, holds. Every query in `catalog.repository.server.ts` includes `shopId` in its where clause (`shopId_id` for individual lookups/updates/deletes; `shopId` filter for list and reorder queries).
  - Self-check 2: checked, holds. Reorder runs inside `prisma.$transaction`. Invalid IDs fail during preflight before any update; mid-transaction rollback is proven by an injected second-update failure (using a proxy wrapper that throws mid-transaction), rolling back completely and leaving original positions intact.
  - Self-check 3: checked, holds. Storage and API checklists satisfied: soft-deletes preserve old orders; Prisma P2025 errors map to 404 `NotFoundError`; input errors throw 400 `ValidationError` with specific error codes.
  - Sabotage 1: Removed `shopId` filter from `getLensGroup` in repository -> red (`expected { ... } to be null`); restored.
  - Sabotage 2: Disabled `LIMITS_INVERTED` validation for SPH limits -> red (`promise resolved instead of rejecting`); restored.
  - Sabotage 3 (R82 transaction-removal): Removed `$transaction` from `runInTx` in repository -> red (`AssertionError: expected +0 to be 30 // Object.is equality` at `expect(check3?.position).toBe(30)`); restored, green.
  - Gates after last code change:
    - `pnpm vitest run app/features/catalog` -> `Test Files  2 passed (2)` / `Tests  59 passed (59)`
    - `pnpm test` -> `Test Files  19 passed (19)` / `Tests  338 passed (338)`
    - `pnpm typecheck` -> exit 0
    - `pnpm lint` (`eslint . --max-warnings 0`) -> exit 0
    - `pnpm build` -> exit 0
- **2026-11-08** — Review R2 fixes implemented (coder agy-4).
  - R2-F1: Fixed parent reassignment in `updateLens` and `updateOptionValue` in `catalog.repository.server.ts` to look up the target parent (`LensGroup` via `groupId` or `OptionGroup` via `optionGroupId`) by compound unique key `shopId_id: { shopId, id }` inside the same transaction (`runInTx`) and throw `NotFoundError` if not in caller's shop. Added two-shop reparenting tests in `app/features/catalog/catalog.repository.server.test.ts` and `app/features/catalog/catalog.service.server.test.ts` asserting `NotFoundError` and leaving both shops' rows unchanged.
  - R2-F4: Corrected Self-check 2 in Log to clarify that rollback is proven by injected second-update failure (since invalid IDs fail during preflight), and recorded the R82 sabotage: removing `$transaction` failed at `expect(check3?.position).toBe(30)` (`expected +0 to be 30`), restored, green.
- **2026-11-08** — Evidence (orchestro spec verify, tree 8fcc90c1): install pass · typecheck pass · lint pass · build pass · test pass 359/0/0
