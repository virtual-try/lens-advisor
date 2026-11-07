# Spec 32 — Admin: lab orders list, resend and ticket download

**Status:** Not started
**Depends on:** Spec 06, Spec 09, Spec 30
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/routes/app.lab-orders._index.tsx`, `app/routes/app.lab-orders.$id.tsx`, `app/features/lab-orders-admin/`, `specs/inventory/32-admin-lab-orders.md`
**Reuses:** `app/features/lab-dispatch/` (spec 30), `app/shared/container/object-store.server.ts` (spec 06), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01)
**Kind:** ui, api
**Invariants:** INV-1, INV-2, INV-7

## Goal

The merchant sees every lab order with its status, can open one to download its ticket, and can resend a
failed or sent one.

## Scope

- List: order name (links to the Shopify order), frame, lens, status badge (Pending / Sending / Sent /
  Failed with the error code in plain words), out-of-limits flag, created date; newest first, 50 per page
  (cursor); filter by status. Empty state explains orders appear after a customer buys lenses.
- Detail: the same fields, the ticket download buttons (presigned 60 s URL, generated on click by an action,
  never in the loader), "Resend to lab" with confirmation `<s-modal>`.
- Detail never shows Rx values; it says "Prescription: on file (typed)" or "(uploaded, 2 files)" (INV-2).
- `nav.ts`: "Lab orders", order 5.

## Explicit non-scope

- Editing a lab order, cancelling → not MVP. Dispatch itself → spec 30.

## Reuse first

- Named in detail: `resend` (30), `presignDownload` via `getObjectStore` (06), `requireActivePlan` (09), Polaris web components
- spec 30's `resend` — no second enqueue path.

## Wiring

Real, used now: 06, 09, 30. Tests: `testConfig()` routes on the real test DB, in-memory object store. Stubbed: none.

## Examples

| State / action | Expected | Why this row |
| --- | --- | --- |
| 3 orders: Sent, Failed `NO_LAB_EMAIL`, Pending | 3 rows; Failed shows "No lab email set" + link to Settings | normal |
| 51 orders | 50 rows + Next | paging |
| Resend on Failed | job enqueued, badge Pending after reload | resend |
| download on Sent | action returns a URL for this shop's key only | normal |
| detail id of another shop | 404 | INV-1 |
| no orders | empty state | empty |

## Steps

1. Read repository + service in `lab-orders-admin`; 2. list; 3. detail + actions; 4. Examples tests.

## Self-check

1. Download URLs are minted in an action per click, not cached in the loader.
2. Error codes map to sentences in one table; unknown codes show "Something went wrong".
3. UI + api checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/lab-orders-admin` passes: every Examples row is a case. [unit]
- [ ] INV-1: the other-shop detail row returns 404. [unit]
- [ ] INV-2: a test renders a detail page for an order with distinctive Rx values and asserts none appears in the HTML. [unit]
- [ ] INV-7: no `style=`/`.css` import in owned files (`rg`). [static]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/32-admin-lab-orders.md` lists the read service and error-code table. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
