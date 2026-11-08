# Inventory fragment — Spec 21 (App proxy: storefront catalog endpoint)

### `proxy-catalog-endpoint`
`app/routes/proxy.catalog.ts` — `GET /apps/lens-advisor/catalog` (app route `/proxy/catalog`) returns the full storefront catalog and shopper-facing settings for the verified shop in a single payload. It authenticates app proxy requests via `authenticate.public.appProxy` before running any logic, derives tenancy exclusively from the verified offline session (`session.shop`), verifies that the shop is installed and active in the database, verifies active subscription via `getPlanStatus`, fetches catalog data via `getStorefrontCatalog(shopId)` and settings via `getSettings(shopId)`, shapes the output into the canonical `CatalogResponse` DTO (`lensGroups`, `optionGroups`, `addOns`, `settings: { manualRxEnabled, rxUploadEnabled, storeRxInOrder }`), validates against `catalogResponseSchema`, and returns `200 OK` with `Cache-Control: private, max-age=60`. Unsigned or forged requests return `401 UNAUTHORIZED` with zero service or repository calls (INV-6); uninstalled shops or inactive plans return `404 NOT_AVAILABLE`; upstream billing failures return `502 BILLING_UNAVAILABLE`.
**Use instead of:** storefronts making multiple unauthenticated round-trips for catalog and settings, or reading settings without proxy signature verification.
**Added by:** spec 21.

### `catalog-response-schema`
`packages/rx-core/src/schemas/catalog.ts` (`catalogResponseSchema`, `CatalogResponse`) — Zod schema and TypeScript type representing the complete storefront catalog payload, comprising `lensGroups`, `optionGroups`, `addOns`, and shopper-safe `settings` (`manualRxEnabled`, `rxUploadEnabled`, `storeRxInOrder`). Extra settings (such as lab email addresses) are omitted by design to prevent data leakage (INV-3).
**Use instead of:** ad-hoc catalog response shapes.
**Added by:** spec 03, consumed by spec 21.
