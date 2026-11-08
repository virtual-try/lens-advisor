# Spec 30 — Lab order dispatch job (ticket → S3 → email)

**Status:** Done
**Depends on:** Spec 05, Spec 06, Spec 07, Spec 14, Spec 15, Spec 23, Spec 24
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/features/lab-dispatch/`, `specs/inventory/30-lab-order-dispatch.md`
**Reuses:** `app/features/lab-orders/lab-orders.repository.server.ts` (spec 23), `app/features/lab-orders/jobs.server.ts` (spec 23), `app/features/lab-orders/ticket/` (spec 24), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/container/object-store.server.ts` (spec 06), `app/shared/container/mailer.server.ts` (spec 07), `app/shared/queue/` (spec 08), `app/features/settings/settings.service.server.ts` (spec 15), `app/features/catalog/catalog.repository.server.ts` (spec 14)
**Kind:** logic, storage
**Invariants:** INV-1, INV-2, INV-8

## Goal

For each queued lab order, build the ticket, store it in S3 and email it with any uploaded prescription
files to the shop's lab addresses — exactly once per order, with a status the merchant can see.

## Scope

- `app/features/lab-dispatch/jobs.server.ts` registers the handler for spec 23's `lab-orders.dispatch`
  (payload `{ labOrderId }`), retry 5 with backoff.
- `loadTicketData(shopId, labOrderId)`: LabOrder + lens/options/add-ons from the catalog (archived rows still
  readable) + prescription decrypted with AAD `shopId:prescriptionId` → `TicketData`. Its own repository
  file in this folder for status updates (spec 23's repository file is not edited).
- Flow: status SENDING (conditional update from PENDING/FAILED — a second worker loses) → render per
  `ticketFormat` → `putObject` at `shops/<shopId>/tickets/<labOrderId>.<ext>` → read upload files →
  `Mailer.send` with `idempotencyKey = labOrder.id + ':' + attempts` → SENT + `providerId`, `sentAt`.
- Errors: record `lastErrorCode` (`NO_LAB_EMAIL`, `MAIL_FAILED`, `STORAGE_FAILED`, `RX_DECRYPT_FAILED`),
  status FAILED, rethrow for retry except `NO_LAB_EMAIL` (permanent). Messages never carry Rx (INV-2).
- `resend(shopId, labOrderId)` service: re-enqueues; used by spec 32.

## Explicit non-scope

- Admin list and buttons → spec 32. Ticket layout → spec 24. Live lab APIs → not MVP.

## Reuse first

- Named in detail: `DISPATCH_JOB` name + lab-orders repository (23), `TicketData`/`renderPdf`/`renderCsv` (24), `getCipher` (05), `getObjectStore` (06), `getMailer` (07), `defineJob` (08), settings service (15), catalog repository (14)
- Renderers (24) and the container getters (05–07) — no new S3 or Resend client.

## Wiring

Real, used now: 05, 06, 07, 14, 15, 23, 24 (tests use the in-memory fakes each adapter spec ships, plus the real
test DB). Stubbed: none.

## Examples

| Situation | Expected | Why this row |
| --- | --- | --- |
| PENDING, format BOTH, 2 lab emails | 2 objects in S3, 1 email with 2 tickets attached, SENT | normal |
| UPLOAD Rx with 2 files | the 2 files attached as well | uploads |
| job delivered twice concurrently | 1 email, 1 SENT row | INV-8 |
| mailer throws | FAILED `MAIL_FAILED`, attempts+1, job retried | retry |
| no lab emails configured | FAILED `NO_LAB_EMAIL`, no retry | permanent |
| labOrderId of shop B in job for shop A | handler loads nothing, logs id only | INV-1 |
| Rx ciphertext tampered | FAILED `RX_DECRYPT_FAILED`, no email | integrity |

## Steps

1. Repository + `loadTicketData`; 2. handler; 3. `resend`; 4. Examples tests.

## Self-check

1. The SENDING transition is one conditional `UPDATE ... WHERE status IN (...)` — check the returned count.
2. Logs and `lastErrorCode` never include Rx values or file contents (INV-2) — test spies on the logger.
3. Archived lenses still render on old orders.
4. Logic + storage checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/lab-dispatch` passes: every Examples row is a case. [unit]
- [ ] INV-1: every repository query is tested with two shops. [unit]
- [ ] INV-2: a logger spy across the failure rows finds no Rx value. [unit]
- [ ] INV-8: the concurrent-delivery test sends exactly one email. [unit]
- [ ] A real dispatch reaches a test inbox with the PDF attached. [requires: Resend API key + verified domain, S3 bucket with KMS key]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/30-lab-order-dispatch.md` lists `loadTicketData`, the handler and `resend`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
