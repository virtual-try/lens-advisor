# Inventory fragment — Spec 19 (Admin: lens options and add-ons)

### `admin-options-route`
`app/routes/app.options._index.tsx` — Admin page displaying option groups (material/index, tint type, colour) with ordered values, and add-ons across three sections with empty and populated states, group creation, reordering, and sync status badges.
**Use instead of:** direct database manipulation or unrouted admin pages for options and add-ons.
**Added by:** spec 19.

### `admin-options-id-route`
`app/routes/app.options.$id.tsx` — Admin route for creating, updating, and archiving option values with money delta validation, code exclusivity check (token vs override), swatch for colour groups, and Shopify product synchronization (sync on delta > 0, archive product and clear variant id on delta -> 0).
**Use instead of:** hand-rolled option value endpoints.
**Added by:** spec 19.

### `admin-add-ons-id-route`
`app/routes/app.add-ons.$id.tsx` — Admin route for creating, updating, and archiving add-ons with money price validation and Shopify product synchronization.
**Use instead of:** hand-rolled add-on endpoints.
**Added by:** spec 19.

### `admin-options-nav`
`app/features/catalog-options/nav.ts` — Navigation descriptor exporting `{ label: "Options & add-ons", href: "/app/options", order: 20 }` discovered by the app navigation glob.
**Use instead of:** hardcoding option catalog links in the admin layout.
**Added by:** spec 19.

### `OptionValueForm`
`app/features/catalog/components/option-value-form.tsx` — Polaris web-component form component for creating and editing option values. Accepts label, price delta, code source (token key=VALUE or override code), and swatch colour for COLOR groups. Displays inline validation errors.
**Use instead of:** duplicating option value form markup across admin screens.
**Added by:** spec 19.
