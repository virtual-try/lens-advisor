# Spec 22 — App proxy: prescription submit and upload endpoints

**Status:** Not started
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

- [x] `pnpm vitest run app/features/prescriptions` passes (route tests live in `app/features/prescriptions/routes.test.ts`): every Examples row is a case. [unit]
- [x] INV-1: repository functions tested with two shops; a cross-shop upload key is refused. [unit]
- [x] INV-2: a test reads the raw `cipher` column and asserts the submitted SPH text is absent; captured logs contain no Rx value. [unit]
- [x] INV-6: unsigned and malformed requests return 401/400 and write nothing. [unit]
- [ ] A real upload from a phone browser on a dev store lands in S3 encrypted. [requires: Shopify dev store, AWS bucket]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/22-proxy-prescription-endpoints.md` lists endpoints and the repository. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 22 implemented by coder agy-3 (engine agy) in worktree `spec-22` on branch `spec/22-proxy-prescription-endpoints`. No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Real upload to phone browser box left unticked per Ruling R7: requires live Shopify dev store and live AWS S3 bucket with KMS key provided by owner.
- **2026-11-08** — Implemented repository `app/features/prescriptions/prescriptions.repository.server.ts`:
  - `findShopByDomain(db, domain)`: resolves Shop id by verified shop domain.
  - `createPrescription(db, shopId, input)`: creates shop-scoped prescription row with unguessable UUID.
  - `getPrescriptionById(db, shopId, id)`: shop-scoped lookup via `@@unique([shopId, id])` (INV-1).
  - `attachOrder(db, shopId, prescriptionId, orderId)`: shop-scoped order attachment.
  - `updatePrescriptionUpload(db, shopId, id, data)`: updates rxType and uploadKeys for draft upload rows.
- **2026-11-08** — Implemented in-memory rate limiter `app/features/prescriptions/rate-limiter.server.ts`:
  - `MemoryRateLimiter` rolling-window limiter (20 requests / 60 seconds / shop+IP); throws `RateLimitedError` with 429 status and `RATE_LIMITED` code on 21st request.
- **2026-11-08** — Implemented domain service `app/features/prescriptions/prescriptions.service.server.ts`:
  - `requestUploadUrl(shopId, input)`: validates content type (`image/jpeg`, `image/png`, `image/heic`, `application/pdf`), bounds file size to 10 MB, creates draft `Prescription` row (source `UPLOAD`) when `draftId` is not supplied, constructs canonical key `shops/<shopId>/rx/<draftId>/<uuid>.<ext>`, and requests presigned upload URL with SSE-KMS from `ObjectStore`.
  - `submitPrescription(shopId, input)`:
    - MANUAL: validates through `validatePrescription` (spec 10), returns 400 with `fields: [{ path, code }]` on validation failure, normalizes Rx via `normalizePrescription`, generates UUID `prescriptionId`, encrypts payload with AES-256-GCM using AAD `${shopId}:${prescriptionId}` (spec 05, INV-2), and writes row.
    - UPLOAD: verifies `draftId` exists for `shopId` (INV-1), validates every key starts with `shops/<shopId>/rx/<draftId>/` (INV-1, rejects cross-shop with `INVALID_UPLOAD_KEY`), checks object existence in storage via `headObject` (rejects missing with `UPLOAD_MISSING`), and updates prescription row.
  - Returns `{ rxRef }` (unguessable UUID). Zero `react-router` imports, zero Request/Response knowledge.
- **2026-11-08** — Implemented proxy routes `app/routes/proxy.upload-url.ts` and `app/routes/proxy.prescriptions.ts`:
  - Validates HMAC signature via `authenticate.public.appProxy` before performing any work; unsigned or forged requests return 401 `UNAUTHORIZED` and write nothing to database (INV-6).
  - Takes `shopDomain` strictly from verified HMAC proxy context (INV-1).
  - Enforces rate limiting per shop+IP (429 `RATE_LIMITED`).
  - Validates request body with zod schemas from `packages/rx-core` (`uploadUrlRequestSchema` and `prescriptionSubmitBodySchema`); malformed JSON or invalid shapes return 400 `BAD_REQUEST` with zero database writes.
  - Zero request body logging; errors return code and path without Rx values (INV-2).
- **2026-11-08** — Created inventory fragment `specs/inventory/22-proxy-prescription-endpoints.md`.
- **2026-11-08** — Self-checks verified:
  1. INV-2: request body logging is off; errors carry `{ path, code }` without values; captured console logs during prescription submission contain no Rx values. Holds.
  2. AAD uses server-generated id created before encryption (`prescriptionId = idGenerator()`, AAD `${shopId}:${prescriptionId}`), avoiding any update-after-encrypt race. Holds.
  3. Security + api + storage checklists (`spec-quality.md` §8) verified and hold.
- **2026-11-08** — Sabotage verifications:
  1. In `prescriptions.service.server.ts`: bypassed cross-shop key prefix check (`false as boolean && !key.startsWith(expectedPrefix)`) → `pnpm vitest run app/features/prescriptions/prescriptions.service.server.test.ts -t "another shop's prefix"` failed: expected `INVALID_UPLOAD_KEY`, received `UPLOAD_MISSING`. Restored → green.
  2. In `app/routes/proxy.prescriptions.ts`: bypassed `authenticate.public.appProxy` rejection throw → `pnpm vitest run app/features/prescriptions/routes.test.ts -t "Row 6: unsigned request"` failed: expected 401, received 500. Restored → green.
- **2026-11-08** — Gates after final code changes:
  - `pnpm vitest run app/features/prescriptions`: Test Files 3 passed (3), Tests 25 passed (25).
  - `pnpm test`: Test Files 31 passed (31), Tests 380 passed (380), 0 failures.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint` (`eslint . --max-warnings 0`): exit 0.
  - `pnpm build`: exit 0.
  - `git diff --check`: clean.
- **2026-11-08** — Evidence (orchestro spec verify, tree 345b94c8): install pass · typecheck pass · lint pass · build pass · test pass 415/0/0
