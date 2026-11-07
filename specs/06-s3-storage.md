# Spec 06 — S3 storage adapter

**Status:** Not started
**Depends on:** Spec 01
**Model:** Standard — `claude-sonnet-5-5` · `gpt-6.1-sol` · `gemini-3.8-flash`
**Issue:** —
**Owns:** `app/shared/storage/object-store.server.ts`, `app/shared/storage/object-store.server.test.ts`, `app/shared/container/object-store.server.ts`, `specs/inventory/06-s3-storage.md`
**Reuses:** `app/shared/config.server.ts` (spec 01)
**Kind:** integration, security
**Invariants:** INV-2, INV-10

## Goal

One module through which the app reaches S3: presigned upload URLs for prescription files, server-side
puts for lab tickets, presigned short-lived downloads, and delete-by-prefix for shop redaction.

## Scope

- `createObjectStore({ client, bucket, kmsKeyId })` — the S3 client is injected (tests pass a fake).
- Key layout (fixed here, used by everyone): `shops/<shopId>/rx/<prescriptionId>/<uuid>.<ext>` and
  `shops/<shopId>/tickets/<labOrderId>.<pdf|csv>`.
- `presignUpload({ key, contentType, maxBytes })`: only `image/jpeg`, `image/png`, `image/heic`,
  `application/pdf`; max 10 MB; expires in 5 minutes; requires SSE-KMS (`S3_KMS_KEY_ID`).
- `putObject`, `presignDownload` (60 s), `headObject`, `deletePrefix(prefix)` (paginates; returns count).
- Key builder refuses a `shopId`/id containing `/` or `..`.

- Add the lazy getter in `app/shared/container/` (see `ARCHITECTURE.md#hot-files--designed-out`), reading config once.

## Explicit non-scope

- Validating that an upload belongs to a prescription → spec 22.
- Bucket creation, IAM, lifecycle rules → left to a human (spec 00); deploy notes in `README.md` Open questions.

## Reuse first

- Named in detail: `app/shared/config.server.ts` (spec 01: `S3_BUCKET`, `S3_REGION`, AWS credentials, `S3_KMS_KEY_ID`)
- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, exact names confirmed in
  `docs/research/libraries.md`). Config from spec 01.

## Wiring

Real, used now: config module. In tests: a fake S3 client recording commands.
Stubbed: none. Consumers: 22, 25, 30.

## Examples

| Call | Expected | Why this row |
| --- | --- | --- |
| presignUpload png, 2 MB | URL; command carries SSE-KMS + key id | normal |
| presignUpload `text/html` | `UnsupportedTypeError` | invalid type |
| presignUpload 10 MB + 1 byte | `TooLargeError` | size boundary |
| key with shopId `a/../b` | `InvalidKeyError` | path traversal |
| deletePrefix with 1,500 objects | 2 list pages, 2 delete batches, returns 1500 | pagination |
| deletePrefix of empty prefix `""` | `InvalidKeyError` (never deletes the bucket) | hostile |

## Steps

1. Implement against an injected client; 2. every Examples row a test with the fake client.

## Self-check

1. Every put and presigned put sets server-side encryption — assert on the recorded command (INV-2).
2. `deletePrefix` cannot be called with a prefix that is not under `shops/<id>/` (INV-10).
3. Security checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/shared/storage/object-store.server.test.ts` passes: every Examples row is a case. [unit]
- [x] INV-2: a test asserts every recorded Put/presigned Put command has SSE-KMS set. [unit]
- [x] INV-10: a test asserts `deletePrefix` paginates to completion and refuses prefixes outside `shops/<id>/`. [unit]
- [ ] A real presigned upload to the bucket succeeds and the object reports SSE-KMS. [requires: AWS account, bucket, KMS key — owner provides]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/06-s3-storage.md` lists `createObjectStore` and the key builders. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-07** — Spec 06 implemented by agy-4:
  - Installed `@aws-sdk/client-s3` (3.1163.0) and `@aws-sdk/s3-request-presigner` (3.1163.0) to workspace root.
  - Implemented `app/shared/storage/object-store.server.ts`:
    - `createObjectStore({ client, bucket, kmsKeyId, presigner?, onCommand? })` factory creating `ObjectStore`.
    - Key layout and validation: `buildRxKey`, `buildTicketKey`, `buildShopPrefix`, `buildRxPrefix`, `buildTicketPrefix`.
    - Enforced path-traversal safeguards refusing `/`, `\`, `..`, and null bytes in all identifiers (`assertValidId`, `assertValidExtension`, `validateKey`, `validateShopScopedPrefix`).
    - `presignUpload`: restricted to `image/jpeg`, `image/png`, `image/heic`, `application/pdf`; max 10 MB (`MAX_UPLOAD_BYTES`); 5-minute TTL (300 s); enforced SSE-KMS (`ServerSideEncryption: "aws:kms"`, `SSEKMSKeyId: kmsKeyId`) with hoisted headers.
    - `putObject`: sets SSE-KMS (`ServerSideEncryption: "aws:kms"`, `SSEKMSKeyId: kmsKeyId`) on every command.
    - `presignDownload`: 60-second default TTL, GetObjectCommand presigning, key validation.
    - `headObject` and `objectExists`: metadata query returning `{ exists, contentLength, contentType, eTag, lastModified, serverSideEncryption, sseKmsKeyId }` or `null` on 404/NotFound.
    - `deletePrefix`: strict validation requiring prefix to start under `shops/<id>/`; paginated list and chunked delete (max 1000 per DeleteObjects batch); returns total deleted count.
  - Implemented lazy composition root getter `getObjectStore()` in `app/shared/container/object-store.server.ts` consuming `getConfig().s3`.
  - Created inventory fragment `specs/inventory/06-s3-storage.md` documenting `object-store`, `key-builders`, and `object-store-container`.
  - Self-check items verified:
    1. Every put and presigned put sets server-side encryption: verified on recorded `PutObjectCommand` instances for both `putObject` and `presignUpload` (`ServerSideEncryption === "aws:kms"` and `SSEKMSKeyId === kmsKeyId`). Holds.
    2. `deletePrefix` cannot be called with a prefix that is not under `shops/<id>/`: verified across hostile inputs (`""`, `"/"`, `"shops"`, `"shops/"`, `"shops//"`, `"other/"`, `"shops/../other/"`) — all rejected with `InvalidKeyError`. Holds.
    3. Security checklist: KMS encryption enforced at rest (INV-2); path traversal completely blocked; upload size strictly bounded to 10 MB; short presigned URL TTLs (300s upload, 60s download); pagination batching protects against API limits; zero credential or plaintext logging; zero `process.env` access outside `config.server.ts`. Holds.
  - Sabotage verifications:
    - sabotage: removed `ServerSideEncryption: "aws:kms"` and `SSEKMSKeyId` from `presignUpload` -> test failed (expected "aws:kms", got undefined) -> red; restored -> green.
    - sabotage: bypassed `validateShopScopedPrefix` validation -> hostile `deletePrefix("")` and INV-10 prefix filter tests failed (promise resolved +0 instead of rejecting) -> red; restored -> green.
  - Automated gates:
    - `pnpm vitest run app/shared/storage/object-store.server.test.ts`: 20/20 passed in 402ms.
    - `pnpm test`: 43/43 passed across 6 test files in 509ms.
    - `pnpm typecheck`: 0 errors.
    - `pnpm lint`: 0 errors, 0 warnings.
    - `pnpm build`: passed.
- **2026-11-07** — Presigned upload to real bucket box left unticked: requires a live AWS account, S3 bucket, and KMS key provided by the owner. Offline unit and integration tests with fake S3 client and signature generation pass 100%.
- **2026-11-07** — Evidence (orchestro spec verify, tree a5d37619): install pass · typecheck pass · lint pass · build pass · test pass 50/0/0
