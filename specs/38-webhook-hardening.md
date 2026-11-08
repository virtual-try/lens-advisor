# Spec 38 — Webhook payload validation and route persistence decoupling

**Status:** Not started
**Depends on:** Spec 34
**Model:** Standard — `claude-sonnet-4-5` · `gpt-5-codex` · `gemini-2.5-pro`
**Issue:** —
**Owns:** `app/routes/webhooks.app.scopes_update.tsx`, `app/routes/webhooks.products.update.tsx`, `app/features/compliance/` or `app/shared/session/`, test files
**Reuses:** `INVARIANTS.md` (INV-6), `ARCHITECTURE.md` (structural invariant 1)
**Kind:** bugfix
**Invariants:** INV-6

## Goal

Harden production webhook routes by adding Zod payload schema validation, preventing unvalidated raw payload logging, and decoupling route handlers from direct Prisma database access to satisfy INV-6 and Structural Invariant 1.

## Scope

- In `app/routes/webhooks.app.scopes_update.tsx`:
  - Define a Zod schema for the `app/scopes_update` webhook payload (validating `current` as an array of strings).
  - Eliminate direct `import db from "../db.server"` and `db.session.update` in the route; move session scope updates behind a dedicated service/repository function satisfying Structural Invariant 1.
  - Return a canonical 400 Bad Request if the payload fails Zod validation without executing database writes.
- In `app/routes/webhooks.products.update.tsx`:
  - Define a Zod schema for the `products/update` webhook payload.
  - Remove `console.log(JSON.stringify(payload, null, 2))` and replace it with logging of safe identifiers only (e.g. `shop`, `topic`, `payload.id`).
  - Return 400 Bad Request on invalid payloads.
- Add test coverage for both webhook routes verifying valid payload processing and rejection of malformed payloads.

## Explicit non-scope

- Changes to Shopify webhook subscription registration in `shopify.app.toml`.
- Changes to app proxy endpoints.
- Modifying compliance webhook routes (`webhooks.compliance.ts`).

## Reuse first

- `authenticate.webhook` from `app/shopify.server.ts`
- Zod schemas pattern from `packages/rx-core` and other webhook routes

## Wiring

Real, used now: `app/routes/webhooks.app.scopes_update.tsx`, `app/routes/webhooks.products.update.tsx`. In tests: mocked webhook requests. Stubbed: none. Consumers: Shopify webhook dispatch.

## Examples

| Route | Current Behavior | Hardened Behavior |
|---|---|---|
| `webhooks.app.scopes_update.tsx` | Unvalidated `payload.current as string[]`; imports `db.server` | Zod validation; delegates persistence to service; returns 400 on error |
| `webhooks.products.update.tsx` | Dumps raw `JSON.stringify(payload)` to console | Zod validation; logs product ID only; returns 400 on error |

## Steps

1. Define Zod schemas for `app/scopes_update` and `products/update` payloads.
2. Create session scope update service function in the appropriate server module.
3. Refactor `app/routes/webhooks.app.scopes_update.tsx` to validate payload with Zod and delegate persistence to the service.
4. Refactor `app/routes/webhooks.products.update.tsx` to validate payload with Zod and log IDs only.
5. Add unit tests for both routes covering valid and malformed payload scenarios.
6. Verify with `rg 'db\.server' app/routes/` that no route directly imports `db.server`.
7. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Self-check

1. `rg 'db\.server' app/routes/` returns 0 hits.
2. Webhooks validate input schemas with Zod before processing.
3. No raw payloads dumped to console logs.

## Done when

- [x] `app/routes/webhooks.app.scopes_update.tsx` validates payload using a Zod schema and returns 400 on invalid payloads. [unit]
- [x] `app/routes/webhooks.app.scopes_update.tsx` calls a service instead of directly importing `db.server` or executing Prisma queries (structural invariant 1). [static]
- [x] `app/routes/webhooks.products.update.tsx` validates payload using a Zod schema, logs product IDs only, and returns 400 on invalid payloads. [unit]
- [x] Unit tests verify both webhooks accept valid payloads and reject malformed payloads with 400. [unit]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm test` passes with 0 failures. [suite]

## Log

- **2026-11-09** — Spec created to address webhook payload validation (INV-6) and route persistence decoupling (Structural Invariant 1) from R2-F3, R2-F4, R2-F6.
- **2026-11-09** — Webhook hardening completed:
  - Created `app/shared/session/session.repository.server.ts` and `session.service.server.ts` providing `updateSessionScope` with required shop scoping (INV-1) and factory `createSessionService` (Structural Invariant 1).
  - Refactored `app/routes/webhooks.app.scopes_update.tsx`:
    - Defined `scopesUpdateWebhookPayloadSchema` validating `current: z.array(z.string())`.
    - Removed direct `import db from "../db.server"` and Prisma calls; delegated session scope updates to `updateSessionScope`.
    - Added 400 Bad Request response on invalid payloads without executing database writes.
  - Refactored `app/routes/webhooks.products.update.tsx`:
    - Defined `productUpdateWebhookPayloadSchema` validating `id: z.union([z.number().int().positive(), z.string().min(1)])`.
    - Removed raw `console.log(JSON.stringify(payload, null, 2))`; replaced with safe identifier logging (`shop`, `topic`, `payload.id`).
    - Added 400 Bad Request response on invalid payloads.
  - Added unit test suites:
    - `app/shared/session/session.server.test.ts`: DB-backed repository and service tests proving persistence, array scope joining, mandatory shop enforcement, and two-shop isolation (INV-1).
    - `app/routes/webhooks.app.scopes_update.test.ts` (15 tests): schema validation, 401 on auth failure, 400 on malformed payloads without writes, 200 on success, and static check asserting 0 references to `db.server`.
    - `app/routes/webhooks.products.update.test.ts` (16 tests): schema validation, 401 on auth failure, 400 on malformed payloads, safe identifier logging, and anti-dumping static check.
  - Review fix round R1:
    - R1-F1: Made `shop` a required parameter on repository and service scope update signatures; queries strictly filter by `{ id, shop }` (INV-1). Added two-shop isolation and missing-shop tests across repository and service layers.
    - R1-F2: Removed unused `getSession`/`findSessionById` read path and tests to avoid exposing full Prisma Session rows.
  - Verification gates:
    - `rg 'db.server' app/routes/` returns 0 hits.
    - `pnpm typecheck`: 0 errors.
    - `pnpm lint`: 0 errors, 0 warnings.
    - `pnpm test`: 75 test files passed, 1345 tests passed, 0 failures.
    - `pnpm test:e2e --project=server`: 30 passed, 0 failures.
    - `pnpm build`: passed.
- **2026-11-08** — Evidence (orchestro spec verify, tree b325f61d): install pass · typecheck pass · lint pass · build pass · test pass 1348/0/0
