# Spec 01 — App scaffold, workspace and unit harness

**Status:** Not started
**Depends on:** Spec 00
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.env.example`, `shopify.app.toml`, `app/shopify.server.ts`, `app/routes/app.tsx`, `app/shared/config.server.ts`, `app/shared/config.server.test.ts`, `app/shared/container/prisma.server.ts`, `app/shared/http/`, `app/shared/nav/`, `packages/rx-core/package.json`, `packages/rx-core/tsconfig.json`, `packages/rx-core/src/harness.test.ts`, `render.yaml`, `specs/inventory/01-scaffold.md`
**Reuses:** `00-stack-and-architecture-decision.md`, `ARCHITECTURE.md`, `../docs/research/stack.md`
**Kind:** scaffold
**Invariants:** —

## Goal

A running Shopify React Router app in a pnpm workspace with every hot file pre-shaped, the config module
declaring every MVP env var, and the commands every later spec cites working on a trivial test.

## Scope

- `shopify app init` with the React Router template into the repo root (keep `lensadvisor_blueprint.html`);
  switch Prisma to `postgresql`, pin `prisma`/`@prisma/client` 6.19.x, `url` + `directUrl`. Leave the
  template's `Session` model; spec 02 adds the rest.
- pnpm workspace: root app + `packages/*`. Create `packages/rx-core` with `package.json` (dependency: `zod`
  only), a `tsconfig.json`, and `src/harness.test.ts` (one trivial test); spec 03 creates `src/index.ts`. `packages/configurator` is spec 04's.
- Root scripts: `typecheck` (tsc across workspace), `lint` (ESLint flat config, 0 warnings),
  `test` (Vitest workspace, all packages), `build` (react-router build + `pnpm -r build`), `dev`,
  `start`, `start:worker` (runs `app/worker.server.ts` — spec 08 creates it), `test:e2e` (placeholder that
  prints "owned by spec 33" and exits 1).
- `config.server.ts`: zod-validated, lazy; declares `DATABASE_URL`, `DIRECT_URL`, `SHOPIFY_*` (template),
  `RX_ENCRYPTION_KEYS`, `RX_ENCRYPTION_ACTIVE_KEY_ID`, `S3_BUCKET`, `S3_REGION`, `S3_KMS_KEY_ID`, AWS creds,
  `RESEND_API_KEY`, `MAIL_FROM`, `APP_PROXY_SUBPATH` (= `lens-advisor`). `.env.example` lists all with comments.
  Missing values fail only when that getter is first used, so the template boots without S3 keys.
- `shopify.app.toml`: scopes `read_products,write_products,read_orders,write_app_proxy` (confirm exact names
  in stack.md); app proxy `/apps/lens-advisor` → `/proxy`; webhooks `orders/create`, `app/uninstalled`;
  `compliance_topics` for the three privacy topics → `/webhooks/compliance`.
- `app/shared/nav/`: collects `app/features/*/nav.ts` entries (eager glob) sorted by `order`; `app.tsx`
  renders them in `<s-app-nav>`; no links when none exist.
- `app/shared/http/errors.server.ts`: `AppError(status, code, message)` + one responder per
  `ARCHITECTURE.md#errors`. `app/shared/container/prisma.server.ts`: lazy `getPrisma()`.
- `render.yaml`: web service + background worker (paid plan), env var keys only, no values.

## Explicit non-scope

- Prisma models beyond `Session` → spec 02. Configurator package → spec 04.
- Adapters (cipher, S3, mailer, queue) → specs 05–08. Billing gate → spec 09.
- Any feature route or `nav.ts` → feature specs. Playwright → spec 33.

## Reuse first

- The template's auth, session storage and webhook helpers — do not hand-roll OAuth or HMAC.

## Wiring

Real, used now: template auth + Prisma session storage on Neon (or local Postgres).
Stubbed: `test:e2e` prints its owner and fails until spec 33. Webhook and proxy URLs in the toml have no
route until specs 21–25 — in dev Shopify gets 404s, which is acceptable before deploy; spec 34 confirms all exist.

## Steps

1. Init the template; convert to the workspace; pin versions per stack.md.
2. Config module + tests; errors module + tests; nav glob in `app.tsx` with a test-only `nav.ts` fixture.
3. `packages/rx-core/src/harness.test.ts` plus the config test make `pnpm test` run both projects.
4. Document how to get a local Postgres for `TEST_DATABASE_URL` in `.env.example`.

## Self-check

1. `pnpm test` really runs both workspace projects (check the runner's project list in its output).
2. The app boots with only the template's env vars set (lazy config).
3. No `process.env` outside `config.server.ts` (grep), including template files you touched.

## Done when

- [ ] `pnpm vitest run app/shared/config.server.test.ts` passes: a missing `RESEND_API_KEY` throws only when `getConfig().resend` is read; a malformed key list fails validation with the variable name and no value in the message. [unit]
- [ ] A test renders `app.tsx`'s nav builder with two fixture `nav.ts` entries and asserts both labels in `order`; with none, no `<s-link>` renders. [unit]
- [ ] `pnpm test` passes with 0 failures and its output lists both the app and rx-core projects. [unit]
- [ ] `rg 'process\.env' app packages --glob '!app/shared/config.server.ts'` finds nothing. [static]
- [ ] `shopify app dev` installs the app on a dev store and the embedded admin loads. [requires: Shopify Partner account, dev store — owner provides]
- [ ] `specs/inventory/01-scaffold.md` lists config getters, `AppError`, `getPrisma`, the nav and worker glob contracts. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
