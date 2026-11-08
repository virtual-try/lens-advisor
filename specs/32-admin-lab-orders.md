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

- [x] `pnpm vitest run app/features/lab-orders-admin` passes: every Examples row is a case. [unit]
- [x] INV-1: the other-shop detail row returns 404. [unit]
- [x] INV-2: a test renders a detail page for an order with distinctive Rx values and asserts none appears in the HTML. [unit]
- [x] INV-7: no `style=`/`.css` import in owned files (`rg`). [static]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/32-admin-lab-orders.md` lists the read service and error-code table. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 32 implemented by coder agy-4 (engine agy) in worktree `spec-32` on branch `spec/32-admin-lab-orders`. No git writes (lead commits).
- **2026-11-08** — Navigation `app/features/lab-orders-admin/nav.ts`:
  - Registered "Lab orders" with order 5 (`{ label: "Lab orders", href: "/app/lab-orders", order: 5 }`), discovered automatically by `app/shared/nav/index.ts`.
- **2026-11-08** — Error translation `app/features/lab-orders-admin/errors.ts`:
  - Defined `LAB_ORDER_ERROR_MESSAGES` mapping 11 error codes (`NO_LAB_EMAIL`, `MAIL_FAILED`, `STORAGE_FAILED`, `RX_DECRYPT_FAILED`, `LOAD_FAILED`, `TICKET_RENDER_FAILED`, `NO_LENS_IN_BUNDLE`, `LENS_NOT_FOUND`, `OPTION_NOT_FOUND`, `RX_NOT_FOUND`, `IN_PROGRESS`) to plain English sentences.
  - Implemented `formatLabOrderError`: unknown codes return `UNKNOWN_ERROR_MESSAGE` ("Something went wrong") (Self-check 2).
- **2026-11-08** — Privacy summary `app/features/lab-orders-admin/summary.ts`:
  - Implemented `formatPrescriptionSummary`: formats metadata into privacy-safe summaries ("Prescription: on file (typed)", "Prescription: on file (uploaded, N file(s))", "None", "Non-prescription") without leaking clinical Rx diopter values or notes (INV-2).
- **2026-11-08** — Repository & Service `app/features/lab-orders-admin/`:
  - `listLabOrders` / `listLabOrdersService`: queries `LabOrder` scoped strictly by `shopId` (INV-1), orders by newest first (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`), supports 50-item cursor pagination and status filtering (`PENDING`, `SENDING`, `SENT`, `FAILED`).
  - `getLabOrderDetail` / `getLabOrderDetailService`: queries `LabOrder` scoped to `shopId` (INV-1); safely joins lens, prescription metadata (never selects `cipher` column, INV-2), option values with option group kind/name, and add-ons.
  - `resendLabOrderService`: validates order tenancy and resets status to `PENDING` by reusing `resend(shopId, labOrderId)` from Spec 30 (INV-1).
  - `getTicketDownloadUrlService`: validates that `ticketKey` starts with `shops/${shopId}/tickets/${labOrderId}.` and has extension `.pdf` or `.csv` (INV-1); mints 60-second presigned S3 download URL via `getObjectStore().presignDownload` (Spec 06, Self-check 1).
- **2026-11-08** — Routes `app/routes/app.lab-orders._index.tsx` & `app/routes/app.lab-orders.$id.tsx`:
  - `app.lab-orders._index.tsx`: List route gated by `requireActivePlan` (Spec 09); renders Shopify order link (`https://admin.shopify.com/store/<handle>/orders/<shopifyOrderId>`), detail link, frame, lens, status badge with translated error message and settings link for `NO_LAB_EMAIL`, out-of-limits badge, created date, cursor pagination next button, and empty state ("Orders appear here after a customer buys lenses.").
  - `app.lab-orders.$id.tsx`: Detail route gated by `requireActivePlan`; renders order fields, options, add-ons, safe prescription summary (INV-2), per-click ticket download action minting 60s URLs without caching in loader (Self-check 1), and "Resend to lab" `<s-modal>` confirmation dialog. Non-matching/foreign shop order returns 404 (INV-1).
- **2026-11-08** — Inventory `specs/inventory/32-admin-lab-orders.md`:
  - Documented `lab-orders-admin-service`, `lab-orders-admin-repository`, `lab-orders-error-codes`, `lab-orders-admin-nav`, and `lab-orders-admin-routes`.
- **2026-11-08** — Self-check items verified:
  1. Download URLs are minted in an action per click, not cached in the loader: verified in loader and action tests (`downloadUrl` undefined in loader data; returned only on POST action with `intent: "download-ticket"`). Checked, holds.
  2. Error codes map to sentences in one table; unknown codes show "Something went wrong": table covers all 11 error codes; unknown codes return "Something went wrong". Checked, holds.
  3. UI + api checklists: strict shopId filtering across all queries (INV-1); no Rx data in HTML, logs, or loader (INV-2); Polaris web components exclusively with no raw CSS / inline style (INV-7); no business logic in route components; clean errors and responses. Checked, holds.
- **2026-11-08** — Sabotage:
  - Sabotaged `getTicketDownloadUrlService` by bypassing the tenant key prefix validation (`if (false && !ticketKey.startsWith(expectedPrefix))`). Ran `pnpm vitest run app/features/lab-orders-admin`: Example Row 4 failed with `AssertionError: expected 'INVALID_TICKET_KEY' to be 'FORBIDDEN_TICKET_KEY'` -> red. Restored check -> green (21/21 passed).
- **2026-11-08** — Gates verified:
  - `pnpm vitest run app/features/lab-orders-admin`: 1 test file, 21/21 passed in 800ms.
  - `pnpm test`: 62 test files, 1149/1149 passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (0 errors, 0 warnings).
  - `pnpm build`: exit 0.
  - `git diff --check`: clean.
- **2026-11-08** — Review R1 fixes implemented:
  - R1-F1: Wrapped `resendLabOrderService` in try/catch in `$id` action, returning `errorResponse(err)`. Rendered `resendFetcher.data.error` banner mapped to sentence, and disabled Resend while fetcher is busy. Tested 409 on PENDING, enqueue failure rollback, and busy state.
  - R1-F2: Seeded INV-2 prescription using real `field-cipher` encrypt with distinctive plaintext (SPH -2.25, CYL -1.50, AXIS 90, notes NOTE-XYZ). Asserted raw DB column, loader JSON, and rendered HTML all lack the plaintext.
  - R1-F3: Preserved user gesture for ticket download: synchronous `window.open("", "_blank")` in click handler, setting `location.href` on arrival or closing tab on error with "Download failed" banner. Disabled buttons while fetcher is submitting. Tested click -> URL opened, error banner, and busy state.
  - R1-F4: Offered only `order.ticketKeys` in detail route. Updated `getTicketDownloadUrlService` to refuse (400 FORBIDDEN_TICKET_KEY) any key not in `order.ticketKeys`. Tested both.
  - R1-F5: Extracted `renderStatusBadge` to `status-badge.tsx` in feature folder. For FAILED orders, show `formatLabOrderError(code) || UNKNOWN_ERROR_MESSAGE` ("Something went wrong" for null/empty). Trimmed error table to emitted codes (Spec 30 dispatch codes + intake codes; removed `IN_PROGRESS`) and removed exact-count pinning test. Tested null code.
  - R1-F6: Validated `status` in `_index.tsx` loader returning `currentStatus: status ?? "ALL"`. Built Next href using `encodeURIComponent`. Tested `?status=foo`.
  - R1-F7: Added tests for exact-50 orders (no Next button), foreign-shop cursor (returns 0 items / no leak), action rejections (missing ticketKey, .exe, unknown intent), and `requireActivePlan` refusal on both routes.
- **2026-11-08** — Gates verified after R1 fixes:
  - `pnpm vitest run app/features/lab-orders-admin`: 1 test file, 35/35 passed.
  - `pnpm test`: 62 test files, 1163/1163 passed, 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0 (0 errors, 0 warnings).
  - `pnpm build`: exit 0.
  - `git diff --check`: clean.
- **2026-11-08** — Evidence (orchestro spec verify, tree b6eae37d): install pass · typecheck pass · lint pass · build pass · test pass 1163/0/0
