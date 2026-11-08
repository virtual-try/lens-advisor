# Spec 25 — Compliance and uninstall webhooks

**Status:** Not started
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

- [x] `pnpm vitest run app/features/compliance` passes: every Examples row is a case. [unit]
- [x] INV-1: shop/redact for A leaves every B row intact. [unit]
- [x] INV-2: captured logs for data_request contain no Rx value; the job payload holds ids only. [unit]
- [x] INV-6: each topic returns 401 on a forged HMAC. [unit]
- [x] INV-8: duplicate request ids produce one job. [unit]
- [x] INV-10: a test enumerates every shop-owned model from the DMMF and asserts zero rows after shop/redact. [unit]
- [ ] `shopify app webhook trigger` for each compliance topic returns 200 against the dev app. [requires: Shopify CLI, dev app]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/25-compliance-webhooks.md` lists routes and jobs. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 25 implemented in this worktree. Not committed.
- **2026-11-08** — Routes `app/routes/webhooks.compliance.ts` and `app/routes/webhooks.app.uninstalled.ts` (the template `.tsx` uninstall route is replaced by the `.ts` file, same URL). Jobs `compliance.customers-redact`, `compliance.customers-data-request`, and `compliance.shop-redact` live in `app/features/compliance/jobs.server.ts` and are discovered with the other feature jobs. Shop redaction walks the Prisma DMMF. Inventory: `specs/inventory/25-compliance-webhooks.md`.
- **2026-11-08** — Valid HMAC tests do not use the app session table. The suite checks the HMAC with the app secret, then returns `{ topic, shop, webhookId, payload }` and runs the real handler, jobs, and `createTestDb` database. A forged HMAC still calls the real `authenticate.webhook` (the 401 test logs `[shopify-api/INFO]`). Removed the `compliance-webhook-debug` line. Renamed the test helper `useStore` to `loadMemoryStore`.
- **2026-11-08** — Self-check 1: holds. `shopOwnedModels` reads the DMMF at runtime. The shop/redact test lists those models itself and asserts each count is 0 for shop A.
- **2026-11-08** — Self-check 2: holds. Delete order comes from DMMF `relationFromFields` (LabOrder before Prescription and Lens, Shop last). `runShopRedact` deletes inside one `$transaction`. The rollback test throws on the second `deleteMany` and asserts the shop snapshot is unchanged and no prefix was deleted.
- **2026-11-08** — Self-check 3: holds. Forged HMAC is 401 and writes nothing. Bodies go through zod. Job payloads and the data_request log are ids only. The email attachment carries the decrypted prescription. S3 goes through `deletePrefix`.
- **2026-11-08** — Sabotage, then restored: `deleteMany({ where: { shopId } })` became `deleteMany({ where: {} })`. `pnpm vitest run app/features/compliance/compliance.test.ts -t "leaves B"` → 1 failed. Shop B's ShopSettings, Prescription, LabOrder, Lens, and the other shop-owned counts went from 1 to 0. Restored the `shopId` filter.
- **2026-11-08** — `shopify app webhook trigger` left open. It needs a Shopify dev store. Not run.
- **2026-11-08** — Gates after the last code change, with `TEST_DATABASE_URL` pointed at the shared Postgres (`127.0.0.1:54316`, db `lens_test`). The worktree `.env` value is `localhost:5432`, and nothing is listening there.
  - `pnpm typecheck` exit 0
  - `pnpm lint` (`eslint . --max-warnings 0`) exit 0
  - `pnpm vitest run app/features/compliance` → `Test Files  1 passed (1)` / `Tests  11 passed (11)`
  - `pnpm test` → `Test Files  39 passed (39)` / `Tests  571 passed (571)`
  - `pnpm build` exit 0
- **2026-11-08** — Evidence (orchestro spec verify, tree 7965d99d): install pass · typecheck pass · lint pass · build pass · test pass 571/0/0
