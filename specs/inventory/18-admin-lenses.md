# Inventory fragment — Spec 18 (Admin: lens groups and lenses)

### `admin-lenses-index-route`
`app/routes/app.lenses._index.tsx` — Admin list page displaying catalog lens groups as sections and lenses within each group.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all queries and actions strictly to authenticated session shop (INV-1).
- Renders empty state with "Add lens group" button when no groups exist.
- Displays each lens with price, Rx types, limits summary formatted via `formatDiopter` (INV-5, e.g. "SPH −8.00 to +6.00"), and sync status badge ("Synced", "Not synced", or "Sync failed" with "Retry").
- Actions support idempotent sync retry (`retry-sync` calling `syncItem` from spec 17), lens archiving (`archive-lens` calling `archiveLens` and `archiveItem`), group archiving (`archive-group` calling `archiveLensGroup`), and reordering (`reorder-lenses`, `reorder-groups`).
- Uses Polaris web components exclusively with zero raw CSS or inline styles (INV-7).
**Use instead of:** direct database queries or ad-hoc admin list interfaces.
**Added by:** spec 18.

### `admin-lenses-id-route`
`app/routes/app.lenses.$id.tsx` — Admin route for creating (`$id = "new"`) and editing catalog lenses.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all mutations and lookups to session shop (INV-1).
- Validates limits using `parseDiopterText` (spec 10), price via `parseMoneyText` (spec 13), and lab-code template via `validateTemplate` (spec 12).
- Saves lens via `createLens` or `updateLens` (spec 14), then synchronizes immediately with Shopify via `syncItem` (spec 17).
- Preserves database save if Shopify sync fails, redirecting to list with sync-failed badge state (Self-check 2).
- Handles lens archiving via `archiveLens` and drafting the Shopify product via `archiveItem`.
**Use instead of:** manual lens creation or unvalidated catalog updates.
**Added by:** spec 18.

### `admin-lens-groups-id-route`
`app/routes/app.lens-groups.$id.tsx` — Admin route for creating (`$id = "new"`) and editing lens groups.
- Protects access using `requireActivePlan(request)` (spec 09) in loader.
- Scopes all reads and writes to session shop (INV-1).
- Validates group name uniqueness within the shop via `createLensGroup` / `updateLensGroup` (spec 14).
- Supports archiving groups via `archiveLensGroup`.
**Use instead of:** direct database manipulation for lens groups.
**Added by:** spec 18.

### `LensForm`
`app/features/catalog/components/lens-form.tsx` — Reusable Polaris form component for creating and editing lenses.
- Provides text inputs for SPH, CYL, and ADD limits parsed using `parseDiopterText` (spec 10), supporting minus signs, decimal commas, and plano.
- Validates limits order (`sphMin <= sphMax`, `cylMin <= cylMax`, `addMin <= addMax`), displaying inline `LIMITS_INVERTED` errors and disabling save.
- Validates lab-code template via `validateTemplate` (spec 12), displaying inline errors (e.g. `UNCLOSED_TOKEN`, `EMPTY_TEMPLATE`) and disabling save when invalid.
- Generates live preview of default lab code using `compileLabCode(template, [])` (spec 12).
- Renders confirmation modal (`<s-modal>`) before archiving lenses.
- Uses Polaris web components only with zero custom styles or classes (INV-7).
**Use instead of:** raw form elements or unvalidated inputs for lens editing.
**Added by:** spec 18.

### `catalog-nav`
`app/features/catalog/nav.ts` — Navigation registration for the catalog feature in the admin sidebar.
- Registers "Lenses" link at `/app/lenses` with order 10.
**Use instead of:** hardcoding catalog navigation links.
**Added by:** spec 18.
