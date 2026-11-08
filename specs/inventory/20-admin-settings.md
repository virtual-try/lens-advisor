# Inventory fragment — Spec 20 (Admin: settings page)

### `admin-settings-route`
`app/routes/app.settings.tsx` — Settings page route (`loader`, `action`, default UI component). Manages lab email addresses, ticket format, manual and upload prescription inputs, the order privacy toggle (`storeRxInOrder`), and displays the current billing plan with a link to Shopify's managed pricing page. Saves settings via `updateSettings` (spec 15), checks billing status via `requireActivePlan` (spec 09), enforces confirmation for storing prescriptions in Shopify orders (INV-3), scopes all reads and writes to the session shop (INV-1), and styles with Polaris web components only (INV-7).
**Use instead of:** configuring shop settings in ad-hoc routes or writing settings directly to the database.
**Added by:** spec 20.

### `admin-settings-nav`
`app/features/settings/nav.ts` — Admin navigation item for Settings (`{ label: "Settings", href: "/app/settings", order: 90 }`). Discovered automatically by `app/shared/nav/index.ts`.
**Use instead of:** hardcoding settings link in navigation components.
**Added by:** spec 20.
