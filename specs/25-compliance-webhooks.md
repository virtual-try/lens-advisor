# Spec 25 — Compliance and uninstall webhooks

**Status:** Done
**Depends on:** Spec 02, Spec 06, Spec 07, Spec 08
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/routes/webhooks.compliance.ts`, `app/routes/webhooks.app.uninstalled.ts`, `app/features/compliance/`, `specs/inventory/25-compliance-webhooks.md`
**Reuses:** `app/shared/container/object-store.server.ts` (spec 06), `app/shared/container/mailer.server.ts` (spec 07), `app/shared/queue/` (spec 08), `test/db.ts` (spec 02), `app/shopify.server.ts` (spec 01)
**Kind:** api, storage, security
**Invariants:** INV-1, INV-2, INV-6, INV-8, INV-10

## Goal

Meet Shopify's mandatory privacy webhooks and clean up on uninstall: redact a customer's prescriptions,
answer a customer data request, and delete everything for a shop.

## Scope

- One route for the three compliance topics (dispatch on topic); one for `app/uninstalled`. Each verifies
  (401 on bad HMAC — required by Shopify), records a `ComplianceRequest` (unique Shopify id), enqueues a job,
  returns 200.
- `customers/redact` job: for the listed order ids, delete their `Prescription` rows and S3 `rx/<id>/`
  objects; null the `prescriptionId` on their LabOrders.
- `customers/data_request` job: collect that customer's prescriptions (decrypted) for the listed orders and
  email a JSON attachment to the shop's contact email (from the payload/Admin API) — the merchant then
  answers the customer. Log ids only.
- `shop/redact` job: delete every row for the shop in every shop-owned model (enumerated from the Prisma
  DMMF, INV-10) and `deletePrefix("shops/<shopId>/")`.
- `app/uninstalled`: mark `Shop.uninstalledAt`, delete sessions (template behaviour); data is kept until
  `shop/redact` (Shopify sends it 48 h later).

## Explicit non-scope

- Merchant UI for data requests → out of MVP (spec 00).

## Reuse first

- Named in detail: `getObjectStore().deletePrefix` (06), `getMailer` (07), `defineJob` (08), `createTestDb` (02), `authenticate.webhook`
- Template webhook auth and session cleanup. spec 06 `deletePrefix` — no direct S3 calls.

## Wiring

Real, used now: 02, 06, 07, 08. Tests: fake object store and mailer; real DB and queue. Stubbed: none.

## Examples

| Webhook | Expected | Why this row |
| --- | --- | --- |
| customers/redact for orders [1001] | that order's prescriptions + S3 objects gone; others remain | normal |
| same request id twice | one job, idempotent | INV-8 |
| shop/redact for shop A | zero rows for A in every model; B untouched; prefix deleted | INV-10 / INV-1 |
| data_request | one email to shop contact with JSON attachment; log has ids only | INV-2 |
| bad HMAC on any topic | 401 | INV-6 + Shopify requirement |

## Steps

1. Routes; 2. three jobs; 3. Examples tests including the DMMF enumeration.

## Self-check

1. INV-10: the model list comes from the DMMF at test time — a new model added later fails this test until covered.
2. Deletion order respects FKs, inside a transaction per shop.
3. Security + storage checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/compliance` passes: every Examples row is a case. [unit]
- [ ] INV-1: shop/redact for A leaves every B row intact. [unit]
- [ ] INV-2: captured logs for data_request contain no Rx value; the job payload holds ids only. [unit]
- [ ] INV-6: each topic returns 401 on a forged HMAC. [unit]
- [ ] INV-8: duplicate request ids produce one job. [unit]
- [ ] INV-10: a test enumerates every shop-owned model from the DMMF and asserts zero rows after shop/redact. [unit]
- [ ] `shopify app webhook trigger` for each compliance topic returns 200 against the dev app. [requires: Shopify CLI, dev app]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/25-compliance-webhooks.md` lists routes and jobs. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
