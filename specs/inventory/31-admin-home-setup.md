# Inventory fragment — Spec 31 (Admin home and setup checklist)

### `admin-home-loader`
`app/features/home/home.server.ts` — `loadHomeData(request, deps?)` gates through `requireActivePlan(request)` (spec 09), inspects lens catalog state via `listLenses` (spec 14) and lab-email configuration via `isComplete` (spec 15), builds the product template theme-editor deep link with the app API key from config (spec 01), and returns `{ hasLens, hasLabEmail, apiKey, themeDeepLink }`.
**Use instead of:** direct database queries or ad-hoc checklist calculation in admin route loaders.
**Added by:** spec 31.

### `admin-home-view`
`app/features/home/home-view.tsx` — `HomeView` component rendering the setup checklist and "You're live" card using Polaris web components without custom CSS.
**Use instead of:** ad-hoc setup checklist UI in admin routes.
**Added by:** spec 31.
