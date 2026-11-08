# Spec 22 — App proxy: prescription submit and upload endpoints

**Status:** Done
**Depends on:** Spec 02, Spec 05, Spec 06, Spec 10
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/routes/proxy.prescriptions.ts`, `app/routes/proxy.upload-url.ts`, `app/features/prescriptions/`, `specs/inventory/22-proxy-prescription-endpoints.md`
**Reuses:** `packages/rx-core/src/rx/validate.ts` (spec 10), `packages/rx-core/src/schemas/` (spec 03), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/container/object-store.server.ts` (spec 06), `test/db.ts` (spec 02), `app/shopify.server.ts` (spec 01)
**Kind:** api, security, storage
**Invariants:** INV-1, INV-2, INV-6

## Goal

The storefront can store a prescription — typed values or uploaded files — and get back an opaque
`rxRef` to put on the cart line; the values are encrypted at rest and the files sit in S3 under the shop.

## Scope

- `POST /apps/lens-advisor/upload-url` `{ contentType, size }` → creates a draft `Prescription` (source
  UPLOAD) if no `draftId` is passed, returns `{ draftId, uploadUrl, key }` (presign via spec 06).
- `POST /apps/lens-advisor/prescriptions` `{ rxType, prescription? , draftId?, uploadedKeys? }`:
  re-validates with spec 10 (never trust the browser); for MANUAL encrypts the payload with AAD
  `shopId:prescriptionId`; for UPLOAD checks every key is under `shops/<shopId>/rx/<draftId>/` and exists
  (`headObject`). Returns `{ rxRef }` = the prescription id (UUID, unguessable).
- Repository `prescriptions.repository.server.ts`: create, attachOrder, getById, all shop-scoped.
- Rate limit: 20 requests / minute / shop+IP in memory per instance (MVP), 429 `RATE_LIMITED`.

## Explicit non-scope

- Attaching to an order → spec 23. Retention of never-ordered prescriptions → README Open questions.
- Reading values from uploads (OCR) → out of MVP (spec 00).

## Reuse first

- Named in detail: `validatePrescription` (10), schemas (03), `getCipher` (05), `getObjectStore` (06), `createTestDb` (02), `authenticate.public.appProxy`
- spec 10 validation — the same function the browser ran; spec 05 cipher; spec 06 key builder.

## Wiring

Real, used now: 02, 05, 06, 10. Tests: fake object store, real test DB, signed proxy requests.
Stubbed: none. Consumers: configurator steps (26, 29) via spec 16's client; spec 23, 30.

## Examples

| Request | Expected | Why this row |
| --- | --- | --- |
| valid MANUAL Rx | 201 `{rxRef}`; DB `cipher` holds no plaintext | normal |
| MANUAL with CYL and no AXIS | 400 `fields:[{path:"od.axis",code:"AXIS_REQUIRED"}]` | server re-validation |
| UPLOAD with a key under another shop's prefix | 400 `INVALID_UPLOAD_KEY` | INV-1 |
| UPLOAD with a key never uploaded | 400 `UPLOAD_MISSING` | integrity |
| upload-url for `text/html` | 400 `UNSUPPORTED_TYPE` | invalid |
| unsigned request | 401, nothing written | INV-6 |
| 21st request in a minute | 429 | rate limit |

## Steps

1. Repository + tests; 2. service (validate, encrypt, verify keys); 3. two routes; 4. Examples tests.

## Self-check

1. INV-2: request body logging is off for these routes; errors carry codes and paths, not values.
2. AAD uses the server-generated id, created before encryption (no update-after-encrypt race).
3. Security + api + storage checklists (`spec-quality.md` §8).

## Done when

- [ ] `pnpm vitest run app/features/prescriptions` passes (route tests live in `app/features/prescriptions/routes.test.ts`): every Examples row is a case. [unit]
- [ ] INV-1: repository functions tested with two shops; a cross-shop upload key is refused. [unit]
- [ ] INV-2: a test reads the raw `cipher` column and asserts the submitted SPH text is absent; captured logs contain no Rx value. [unit]
- [ ] INV-6: unsigned and malformed requests return 401/400 and write nothing. [unit]
- [ ] A real upload from a phone browser on a dev store lands in S3 encrypted. [requires: Shopify dev store, AWS bucket]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/22-proxy-prescription-endpoints.md` lists endpoints and the repository. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
