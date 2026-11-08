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

- [ ] `app/routes/webhooks.app.scopes_update.tsx` validates payload using a Zod schema and returns 400 on invalid payloads. [unit]
- [ ] `app/routes/webhooks.app.scopes_update.tsx` calls a service instead of directly importing `db.server` or executing Prisma queries (structural invariant 1). [static]
- [ ] `app/routes/webhooks.products.update.tsx` validates payload using a Zod schema, logs product IDs only, and returns 400 on invalid payloads. [unit]
- [ ] Unit tests verify both webhooks accept valid payloads and reject malformed payloads with 400. [unit]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm test` passes with 0 failures. [suite]

## Log

- **2026-11-09** — Spec created to address webhook payload validation (INV-6) and route persistence decoupling (Structural Invariant 1) from R2-F3, R2-F4, R2-F6.
