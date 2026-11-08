# Spec 31 — Admin home and setup checklist

**Status:** Done
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

- [ ] `pnpm vitest run app/features/home` passes: every Examples row is a case (loader + rendered items by text). [unit]
- [ ] INV-1: the two-shop row passes. [unit]
- [ ] INV-7: no `style=`/`.css` import in owned files (`rg`). [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/31-admin-home-setup.md` lists the loader helper. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
