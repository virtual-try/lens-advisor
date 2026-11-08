# Spec 31 — Admin home and setup checklist

**Status:** Not started
**Depends on:** Spec 09, Spec 14, Spec 15
**Model:** Light — `claude-haiku-5-5` · `gpt-6-luna` · `gemini-3.5-flash-lite`
**Issue:** —
**Owns:** `app/routes/app._index.tsx`, `app/features/home/`, `specs/inventory/31-admin-home-setup.md`
**Reuses:** `app/features/billing/` (spec 09), `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/settings/settings.service.server.ts` (spec 15), `app/routes/app.tsx` (spec 01)
**Kind:** ui
**Invariants:** INV-1, INV-7

## Goal

A new merchant lands on a checklist that gets them to a working configurator: add a lens, set a lab
email, add the app block to the product template — each step ticks itself when done.

## Scope

- Replaces the template's demo `app/routes/app._index.tsx` (it exists after spec 01).
- Loader: `requireActivePlan`; lens list from the catalog service is non-empty (14); `isComplete(shopId)` (15) for the lab email; theme block status is not
  detectable in MVP — that item is a link to the theme editor deep link
  (`/admin/themes/current/editor?template=product&addAppBlockId=<api-key>/select-lenses`) with a manual
  "Mark as done" stored in component state only (not persisted — see Open questions).
- Items: "Add your first lens" → `/app/lenses`; "Add a lab email" → `/app/settings`; "Add the Select lenses
  button to your product page" → theme editor. Done items show a tick and stay listed.
- When all data items are done: a short "You're live" card with links to Lab orders and Lenses.

## Explicit non-scope

- Lab orders list → spec 32. Usage analytics → not MVP.

## Reuse first

- Named in detail: `requireActivePlan` (09), catalog service lens list (14), settings service (15), Polaris web components
- Services 14 (lens list) and 15 (`isComplete`) — no Prisma in the route.

## Wiring

Real, used now: 09, 14, 15. Tests: `testConfig()` loader call on a real test DB. Stubbed: none.

## Examples

| Shop state | Expected | Why this row |
| --- | --- | --- |
| no lenses, no lab email | 2 open items + theme link | new shop |
| 1 lens, lab email set | both ticked, "You're live" card | done |
| other shop has lenses | this shop still shows the item open | INV-1 |
| no plan | redirect to plan page (09) | gate |

## Steps

1. Loader; 2. page; 3. Examples tests.

## Self-check

1. The deep link uses the app's real API key from config (01), not a literal.
2. No custom CSS — Polaris components only (INV-7).
3. UI checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/features/home` passes: every Examples row is a case (loader + rendered items by text). [unit]
- [x] INV-1: the two-shop row passes. [unit]
- [x] INV-7: no `style=`/`.css` import in owned files (`rg`). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/31-admin-home-setup.md` lists the loader helper. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 31 implemented by agy-5 in worktree `spec-31` (branch `spec/31-admin-home-setup`). No git writes (lead commits).
  - Loader helper `app/features/home/home.server.ts`: Implemented `loadHomeData(request, deps?)` which gates through `requireActivePlan(request)` (spec 09), resolves the `shopId` from the authenticated session shop domain via Prisma, queries lens catalog state through `listLenses(shopId)` (spec 14) and lab-email configuration status through `isComplete(shopId)` (spec 15), constructs the theme editor deep link (`/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/select-lenses`) using the configured Shopify API key (spec 01), and returns `{ hasLens, hasLabEmail, apiKey, themeDeepLink }`. No Prisma queries in the route module.
  - UI component `app/features/home/home-view.tsx`: Implemented `HomeView` rendering the checklist items ("Add your first lens" -> `/app/lenses`, "Add a lab email" -> `/app/settings`, and "Add the Select lenses button to your product page" -> `themeDeepLink`) using Polaris web components (`s-page`, `s-section`, `s-heading`, `s-paragraph`, `s-stack`, `s-box`, `s-badge`, `s-link`, `s-button`). Completed items show a tick (`✓ Done`) and stay listed. Theme block step includes a manual "Mark as done" toggle held in component state (`useState`). When all data items are complete (`hasLens && hasLabEmail`), a "You're live" card is rendered with links to "Lab orders" (`/app/lab-orders`) and "Lenses" (`/app/lenses`). No custom CSS, classes, or inline styles (INV-7).
  - Route `app/routes/app._index.tsx`: Replaced template demo snowboard code with route module delegating to `loadHomeData` in loader and rendering `HomeView`. Includes standard `ErrorBoundary` and `headers`.
  - Inventory fragment `specs/inventory/31-admin-home-setup.md`: Documented `loadHomeData` helper and `HomeView` component.
  - Self-check 1: checked, holds. Deep link uses `getConfig().shopify.apiKey` from config (spec 01), not a literal string. Tested with real config key and `testConfig()` key.
  - Self-check 2: checked, holds. Polaris web components only. `rg` check for `style=`, `className=`, and `.css` in owned files finds 0 matches.
  - Self-check 3: checked, holds. UI checklist satisfied: empty, active, and complete states tested; items asserted by text and element attributes; manual toggle verified; "You're live" card renders conditionally when data items are done.
  - Sabotage 1 (INV-1): Hardcoded `hasLens = true` in `loadHomeData` -> red (`expected true to be false` for Row 1 and Row 3); restored, green.
  - Sabotage 2 ("You're live" card): Hardcoded `allDataItemsDone = false` in `HomeView` -> red (`Unable to find an element with the text: You're live` for Row 2); restored, green.
  - Sabotage 3 (Deep link key): Hardcoded literal API key `literal-api-key` in `loadHomeData` -> red (Self-check 1 assertion failed); restored, green.
  - Gates after last code change:
    - `pnpm vitest run app/features/home` -> `Test Files  1 passed (1)` / `Tests  8 passed (8)`
    - `pnpm test` -> `Test Files  39 passed (39)` / `Tests  568 passed (568)`
    - `pnpm typecheck` -> exit 0
    - `pnpm lint` (`eslint . --max-warnings 0`) -> exit 0
    - `pnpm build` -> exit 0
    - `git diff --check` -> exit 0
- **2026-11-08** — Evidence (orchestro spec verify, tree 19db6eb3): install pass · typecheck pass · lint pass · build pass · test pass 568/0/0
