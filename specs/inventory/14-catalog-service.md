# Inventory fragment — Spec 14 (Catalog repository and service)

### `catalog-repository`
`app/features/catalog/catalog.repository.server.ts` — `createCatalogRepository(prisma)` and `CatalogRepository` class, plus standalone functions:
- Lens Groups: `listLensGroups(shopId, options?)`, `getLensGroup(shopId, id)`, `createLensGroup(shopId, data)`, `updateLensGroup(shopId, id, data)`, `deleteLensGroup(shopId, id)`, `reorderLensGroups(shopId, ids)`
- Lenses: `listLenses(shopId, options?)`, `getLens(shopId, id)`, `createLens(shopId, data)`, `updateLens(shopId, id, data)`, `deleteLens(shopId, id)`, `reorderLenses(shopId, ids, groupId?)`
- Option Groups: `listOptionGroups(shopId, options?)`, `getOptionGroup(shopId, id)`, `createOptionGroup(shopId, data)`, `updateOptionGroup(shopId, id, data)`, `deleteOptionGroup(shopId, id)`, `reorderOptionGroups(shopId, ids)`
- Option Values: `listOptionValues(shopId, options?)`, `getOptionValue(shopId, id)`, `createOptionValue(shopId, data)`, `updateOptionValue(shopId, id, data)`, `deleteOptionValue(shopId, id)`, `reorderOptionValues(shopId, ids, optionGroupId?)`
- Add-Ons: `listAddOns(shopId, options?)`, `getAddOn(shopId, id)`, `createAddOn(shopId, data)`, `updateAddOn(shopId, id, data)`, `deleteAddOn(shopId, id)`, `reorderAddOns(shopId, ids)`
- Sync and Storefront: `markSynced(shopId, entity, id, variantId, productId?)`, `getStorefrontCatalogData(shopId)`
Prisma persistence layer for merchant lens catalog. Scopes every read and write to `shopId` (INV-1), provides atomic reordering in a single transaction, and performs soft-deletes via `archivedAt`.
**Use instead of:** direct Prisma queries on `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, or `AddOn` tables.
**Added by:** spec 14.

### `catalog-service`
`app/features/catalog/catalog.service.server.ts` — `createCatalogService(deps)` and `CatalogService` class, plus standalone functions:
- Lens Groups: `listLensGroups(shopId, options?)`, `getLensGroup(shopId, id)`, `createLensGroup(shopId, input)`, `updateLensGroup(shopId, id, input)`, `deleteLensGroup(shopId, id)`, `archiveLensGroup(shopId, id)`, `reorderLensGroups(shopId, ids)`
- Lenses: `listLenses(shopId, options?)`, `getLens(shopId, id)`, `createLens(shopId, input)`, `updateLens(shopId, id, input)`, `deleteLens(shopId, id)`, `archiveLens(shopId, id)`, `reorderLenses(shopId, ids, groupId?)`
- Option Groups: `listOptionGroups(shopId, options?)`, `getOptionGroup(shopId, id)`, `createOptionGroup(shopId, input)`, `updateOptionGroup(shopId, id, input)`, `deleteOptionGroup(shopId, id)`, `archiveOptionGroup(shopId, id)`, `reorderOptionGroups(shopId, ids)`
- Option Values: `listOptionValues(shopId, options?)`, `getOptionValue(shopId, id)`, `createOptionValue(shopId, input)`, `updateOptionValue(shopId, id, input)`, `deleteOptionValue(shopId, id)`, `archiveOptionValue(shopId, id)`, `reorderOptionValues(shopId, ids, optionGroupId?)`
- Add-Ons: `listAddOns(shopId, options?)`, `getAddOn(shopId, id)`, `createAddOn(shopId, input)`, `updateAddOn(shopId, id, input)`, `deleteAddOn(shopId, id)`, `archiveAddOn(shopId, id)`, `reorderAddOns(shopId, ids)`
- Sync: `markSynced(shopId, entity, id, variantId, productId?)`
- Storefront: `getStorefrontCatalog(shopId)` returning spec 03 `CatalogResponse`
Exports error class `ValidationError` (extends `BadRequestError`), and DTO types `CatalogLensDto`, `CatalogLensGroupDto`, `CatalogOptionGroupDto`, `CatalogOptionValueDto`, `CatalogAddOnDto`.
Enforces limits constraints (`sphMin <= sphMax`, `cylMin <= cylMax`, `addMin <= addMax` with `LIMITS_INVERTED`), price non-negativity (`NEGATIVE_PRICE`), unique names within groups/shops (`NAME_NOT_UNIQUE`), code exclusivity for option values (`ONE_CODE_SOURCE`), and throws `NotFoundError` on cross-shop or missing IDs.
**Use instead of:** business logic inside admin route loaders/actions or raw Prisma rows past the service boundary.
**Added by:** spec 14.

### `catalog-schemas`
`app/features/catalog/schema.ts` — Zod schemas for admin form inputs and updates: `lensGroupInputSchema`, `lensGroupUpdateSchema`, `lensInputSchema`, `lensUpdateSchema`, `optionGroupInputSchema`, `optionGroupUpdateSchema`, `optionValueInputSchema`, `optionValueUpdateSchema`, `addOnInputSchema`, `addOnUpdateSchema`, `reorderSchema`, helper `validateInput`, and error class `ValidationError`. Enforces integer money (INV-4) and integer hundredths for diopters (INV-5).
**Use instead of:** unvalidated forms or hand-rolled request validation for catalog entities.
**Added by:** spec 14.
