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

- [x] `pnpm vitest run app/features/settings/admin-settings.test.tsx` passes: every Examples row is a case. [unit]
- [x] INV-1: the action ignores any `shopId` in form data and writes the session shop only. [unit]
- [x] INV-3: a post setting `storeRxInOrder=true` without the confirmation field is rejected. [unit]
- [x] INV-7: `rg 'style=|className=|<style' app/routes/app.settings.tsx` finds nothing. [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/20-admin-settings.md` lists the route. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 20 implemented by coder agy-2 (engine agy) in worktree `spec-20` (branch `spec/20-admin-settings`). No git writes (lead commits).
- **2026-11-08** — Implemented `app/routes/app.settings.tsx`:
  - `loader`: Gates via `requireActivePlan(request)` (spec 09). Resolves session shop from `session.shop` (INV-1), reads settings via `getSettings(shop.id)` (spec 15), builds hosted managed pricing URL via `buildPricingPlansUrl(session.shop, getConfig().billing.appHandle)`, and returns `{ settings, plan, pricingUrl }`.
  - `action`: Authenticates via `authenticate.admin(request)`. Resolves `shop` via session domain only. Completely ignores any `shopId` submitted in form or JSON payload (INV-1). Enforces server-side confirmation check for `storeRxInOrder=true`: rejects with 400 Bad Request code `CONFIRMATION_REQUIRED` unless a confirmation field (`confirmStoreRxInOrder`, `confirm`, `confirmed`, `privacyConfirmed`) is truthy (INV-3). Delegates validation and persistence to `updateSettings(shop.id, patch)` (spec 15). Catches `ValidationError` and maps field errors (`EMAIL`, `AT_LEAST_ONE_RX_INPUT`) to inline error responses with status 400.
  - UI Component: Built purely using Polaris web components (`<s-page>`, `<s-section>`, `<s-stack>`, `<s-text-field>`, `<s-select>`, `<s-checkbox>`, `<s-modal>`, `<s-banner>`, `<s-button>`, `<s-link>`). Zero raw CSS, `style=`, `className=`, or `<style` (INV-7). Includes:
    - Lab fulfillment section: lab email input (comma/newline separated), ticket format dropdown (`PDF`, `CSV`, `BOTH`).
    - Prescription inputs section: "Shoppers can type their prescription" (`manualRxEnabled`), "Shoppers can upload a prescription file" (`rxUploadEnabled`).
    - Order privacy section: "Save prescription values in Shopify orders" (`storeRxInOrder`), with help text: "When off, orders show 'Prescription on file' and values stay encrypted in this app". Turning toggle on triggers confirmation `<s-modal id="privacy-confirm-modal">` detailing who can see order properties. Confirming retains toggle state and sets confirmation; cancelling reverts toggle to false.
    - Plan section: displays current plan name and link to change plan in top frame (`target="_top"`).
    - Feedback: inline error banners for `EMAIL`, `AT_LEAST_ONE_RX_INPUT`, and privacy confirmation; App Bridge success toast `shopify.toast.show("Settings saved")`.
- **2026-11-08** — Implemented `app/features/settings/nav.ts`: exports `{ label: "Settings", href: "/app/settings", order: 90 }` for dynamic navigation discovery.
- **2026-11-08** — Implemented `specs/inventory/20-admin-settings.md`: documents `admin-settings-route` and `admin-settings-nav`.
- **2026-11-08** — Implemented `app/features/settings/admin-settings.test.tsx`: 13 tests covering all 5 Examples rows, INV-1, INV-3, loader, and UI rendering (fields, plan card, inline errors, modal cancel/confirm, toast).
- **2026-11-08** — Self-checks:
  - Self-check 1: Holds. A post setting `storeRxInOrder=true` without confirmation is rejected with 400 `CONFIRMATION_REQUIRED` and database value remains false.
  - Self-check 2: UI checklist holds. Pure Polaris web components used, no inline style or className, accessible labels, clear inline errors, success toast via App Bridge, and responsive layout.
- **2026-11-08** — Sabotages:
  - Sabotage 1: Updated `action` to read `targetShopId = rawData.shopId ?? shop.id` -> INV-1 test red (`expected [] to deeply equal ['alpha@example.com']`). Restored.
  - Sabotage 2: Commented out `storeRxInOrder` confirmation check in `action` -> INV-3 test red (`expected 200 to be 400`). Restored.
- **2026-11-08** — Final gate verification:
  - `pnpm vitest run app/features/settings/admin-settings.test.tsx` → `Test Files 1 passed (1)` / `Tests 13 passed (13)`
  - `pnpm test` → `Test Files 28 passed (28)` / `Tests 353 passed (353)`
  - `pnpm typecheck` → exit 0 (0 errors)
  - `pnpm lint` (`eslint . --max-warnings 0`) → exit 0 (0 errors, 0 warnings)
  - `pnpm build` → exit 0
  - `rg 'style=|className=|<style' app/routes/app.settings.tsx` → exit 1 (0 matches, INV-7 clean)
  - `git diff --check` → exit 0 (clean, no trailing whitespace)
- **2026-11-08** — Evidence (orchestro spec verify, tree 4e333bf3): install pass · typecheck pass · lint pass · build pass · test pass 361/0/0
- **2026-11-08** — Fix round R1 accepted findings addressed by coder agy-2:
  - R1-F1 [BLOCKER]: Driven privacy confirmation flow through the toggle (user event opens modal, cancel resets toggle, confirm enables and submits). Sabotage: emptied toggle's open handler -> test failed with `AssertionError: expected false to be true` on `confirmModal?.hasAttribute("open")`. Restored.
  - R1-F2 [BLOCKER]: Replaced all vacuous `toBeDefined()` assertions on `querySelector` results with presence assertions (`not.toBeNull()`, `toBeTruthy()`) plus attribute/text checks.
  - R1-F3 [MAJOR]: Boundary validation of action input via Zod schema (`actionInputSchema`). Primitive/non-object JSON payloads and invalid boolean strings return structured 400 Bad Request via `errorResponse` and write nothing.
  - R1-F4 [MAJOR]: Validation responses return canonical `{ error: { code, message, fields } }` shape via `AppError`/`errorResponse`. UI adapted to consume canonical `fields` array.
  - R1-F5 [MAJOR]: Added authorization refusal test cases where `authenticate.admin` rejects (throws Response): loader and action refuse access and no settings write occurs.
  - R1-F6 [MAJOR]: Switched lab email input to `<s-text-area>`; added round-trip test that two saved addresses render and round-trip unchanged.
  - R1-F7 [MAJOR]: Moved `AT_LEAST_ONE_RX_INPUT` error banner inside the Prescription inputs `<s-section>` (instead of top-level page banner) and added assertion.
  - R1-F8 [MAJOR]: Keyed success toast on completed submission transition to idle with ok data; tested two successive successful saves emit two toasts.
  - R1-F9 [MAJOR]: Added UI component cases for default (empty) settings, submitting state (Save button loading), and field error responses.
- **2026-11-08** — Fix round R2 accepted findings addressed by coder agy-2:
  - R2-F1 [BLOCKER]: Fixed privacy confirmation UI test (`admin-settings.test.tsx`): spied on Polaris modal web component methods `showOverlay`/`hideOverlay` (removed unsupported `s-modal[open]`), asserted Cancel produces no submission and no database write, confirmed toggle and clicked Save, asserted `requestSubmit()` call and observed fetcher submission with `storeRxInOrder: "true"` and `confirmStoreRxInOrder: "true"`, and verified persistent write to database. Sabotages: (1) deleting `showOverlay()` turned test red (`AssertionError: expected "spy" to be called 1 times, but got 0 times`), restored; (2) deleting `requestSubmit()` turned test red (`AssertionError: expected "requestSubmit" to be called at least once`), restored.
