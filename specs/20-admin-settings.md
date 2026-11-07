# Spec 20 — Admin: settings page

**Status:** Not started
**Depends on:** Spec 09, Spec 15
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/routes/app.settings.tsx`, `app/features/settings/nav.ts`, `app/features/settings/admin-settings.test.tsx`, `specs/inventory/20-admin-settings.md`
**Reuses:** `app/features/settings/settings.service.server.ts` (spec 15), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01)
**Kind:** ui, api
**Invariants:** INV-1, INV-3, INV-7

## Goal

One settings page: lab email addresses, ticket format, which prescription inputs shoppers get, the privacy
toggle for storing prescription values in Shopify orders, and the current plan.

## Scope

- Fields: lab emails (multiple), ticket format (PDF / CSV / both), "Shoppers can type their prescription",
  "Shoppers can upload a prescription file", "Save prescription values in Shopify orders" (off by default,
  with help text: "When off, orders show 'Prescription on file' and values stay encrypted in this app").
- Turning the privacy toggle **on** asks for confirmation (`<s-modal>`) stating who can see order properties.
- Plan card: plan name, link to change plan (managed pricing page).
- Save via the settings service; field errors inline; success toast via App Bridge.
- `nav.ts`: "Settings", order 90.

## Explicit non-scope

- Setup checklist → spec 31. Lab orders → spec 32.

## Reuse first

- Named in detail: settings service (15), `getPlanStatus`/`requireActivePlan` (09), Polaris web components
- Settings service validation (15) — the route does not re-validate emails itself.

## Wiring

Real, used now: 15, 09. Tests: `testConfig()` loader/action calls. Stubbed: none.

## Examples

| Input | Expected | Why this row |
| --- | --- | --- |
| add `lab@example.com`, save | saved, toast | normal |
| `lab@` | inline EMAIL error, nothing saved | invalid |
| both Rx inputs unchecked | inline AT_LEAST_ONE_RX_INPUT | invalid |
| privacy toggle on, confirm | saved true | INV-3 |
| privacy toggle on, cancel | stays false | INV-3 |

## Steps

1. Route loader/action; 2. form; 3. Examples tests.

## Self-check

1. The privacy toggle cannot be turned on by a plain form post without the confirmation field (server checks it).
2. UI checklist (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/settings/admin-settings.test.tsx` passes: every Examples row is a case. [unit]
- [ ] INV-1: the action ignores any `shopId` in form data and writes the session shop only. [unit]
- [ ] INV-3: a post setting `storeRxInOrder=true` without the confirmation field is rejected. [unit]
- [ ] INV-7: `rg 'style=|className=|<style' app/routes/app.settings.tsx` finds nothing. [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/20-admin-settings.md` lists the route. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
