# Spec 34 — Verification pass

**Status:** Not started
**Depends on:** Spec 33
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `specs/INVENTORY.md`
**Reuses:** `INVARIANTS.md`, `ARCHITECTURE.md`, `DESIGN-SYSTEM.md`, `INVENTORY.md`

## Goal

The final gate. Prove from a clean state that what the spec set promised is actually true — and record
every place it was not. This spec observes and reports; anything found becomes a new spec.

## Scope

- Clean rebuild: fresh `pnpm install --frozen-lockfile`, typecheck, lint, build (app + configurator bundle).
- Every earlier spec's `Done when` re-checked against the real artifact, not the ticked box.
- Whole unit suite and whole e2e suite, each in one go.
- Fold `specs/inventory/*.md` into `INVENTORY.md`; duplication sweep.
- Steering docs re-read against the code; every `INV-1`…`INV-10` checked by ID.
- Storefront budget: the loader file in `extensions/lens-configurator/assets/` is ≤ 10 KB (theme-check
  guidance); record the configurator bundle size from the build output.

## Explicit non-scope

- Fixing anything found → each finding becomes its own numbered spec in `README.md` and `PROGRESS.md`.
- New features of any kind.

## Steps

1. Clean install; `pnpm typecheck`, `pnpm lint`, `pnpm build`; record real output.
2. `pnpm test`, then `pnpm test:e2e`; record both runner summary lines verbatim.
3. Walk every earlier spec's `Done when`; note every box that does not hold.
4. Fold inventory fragments; run the sweep (near-duplicate exports, raw hex outside `tokens.css`/`design/`,
   inventory entries whose file is gone).
5. Re-read `ARCHITECTURE.md` against the tree (structural invariants 1–7 by grep) and `INVARIANTS.md` by ID.
6. Re-open every `[requires: …]` box left open and every Examples table; grep production code for stubs
   named in `## Wiring` sections.
7. Re-read `DESIGN-SYSTEM.md` against `packages/configurator/src/styles/tokens.css` and component styles.
8. Run `shopify app deploy --dry-run` if available, else `shopify app config validate`; record output.
9. Record everything in the Log with tool output; file follow-up specs.

## Done when

- [x] Clean install + `pnpm typecheck` + `pnpm lint` (0 errors, 0 warnings) + `pnpm build` all pass. [static]
- [x] Whole unit suite and whole e2e suite pass from a clean install; summary lines quoted verbatim in the Log. [suite]
- [x] Every inventory fragment is folded into `INVENTORY.md`. [static]
- [x] Every earlier spec's `Done when` re-checked and the result recorded. [static]
- [x] Duplication sweep run; findings in the Log. [static]
- [x] Every `INV-N` in `INVARIANTS.md` checked against the tree, by ID. [static]
- [x] No stub named in any `## Wiring` section remains in production code. [static]
- [ ] No token used outside `DESIGN-SYSTEM.md`'s list. [static]
- [x] The theme-extension loader asset is ≤ 10 KB (size from the build output). [static]
- [x] Every finding has a follow-up spec or a line saying why it is accepted. [static]

## Log

- **2026-11-09** — Clean rebuild verification:
  - `pnpm install --frozen-lockfile`: clean exit 0, 827 packages reused/added, Prisma Client v6.19.2 generated.
  - `pnpm typecheck`: clean exit 0 across root React Router app, `packages/configurator`, and `packages/rx-core`.
  - `pnpm lint`: clean exit 0, 0 errors, 0 warnings (`eslint . --max-warnings 0`).
  - `pnpm build`: clean exit 0:
    - Server bundle: `build/server/index.js` (523.30 kB).
    - Configurator bundle: `extensions/lens-configurator/assets/configurator.js` 202380 B (197.64 KB gzip: 56.66 kB).
    - Loader CSS: `extensions/lens-configurator/assets/loader.css` 3319 B (3.24 KB gzip: 1.33 kB).
    - Loader JS: `extensions/lens-configurator/assets/loader.js` 1314 B (1.28 KB gzip: 0.71 kB) against budget ≤ 10240 B.
- **2026-11-09** — Test suite runner summaries:
  - Unit suite (`vitest run`):
    `Test Files  72 passed (72)`
    `Tests  1307 passed (1307)`
    `Duration  14.39s (transform 8.15s, setup 1.24s, collect 27.86s, tests 67.61s, environment 13.53s, prepare 4.39s)`
  - End-to-end server suite (`playwright test --project=server`):
    `30 passed (2.9s)`
  - Full end-to-end suite (`playwright test`):
    `5 skipped`
    `30 passed (4.4s)`
    (5 skipped storefront tests require live dev store credentials: `E2E_STORE_URL`, `E2E_STORE_PASSWORD`).
- **2026-11-09** — Inventory folding:
  - Folded all 143 fragment entries across 33 files in `specs/inventory/*.md` into `specs/INVENTORY.md` categorized across 9 architectural sections:
    - Components (admin — Polaris): 4 entries
    - Components (configurator — Preact): 13 entries
    - Hooks: 0 entries
    - API / services: 41 entries
    - Domain logic (packages/rx-core): 20 entries
    - Utils: 18 entries
    - Constants: 7 entries
    - Types and schemas: 23 entries
    - Test helpers and fixtures: 17 entries
  - Verified 143/143 primary file paths exist on disk (0 missing).
  - Verified 143/143 anchors are unique (0 duplicates).
- **2026-11-09** — Earlier specs Done-when walk:
  - Examined all 34 prior specs (00–33): 274 total checkboxes.
  - 253 ticked boxes re-checked and confirmed holding against current codebase artifacts.
  - 14 owner-gated `[requires: ...]` boxes verified intentionally unticked per RULINGS.md R7 (Shopify dev store, AWS S3/KMS, Resend).
  - 7 unticked boxes in orphaned draft `specs/35-fix-web-feature-jobs-glob.md` cleaned up; file superseded by Spec 35.
- **2026-11-09** — Invariants verification by ID:
  - `INV-1` (Tenancy): Every repository query strictly filters by `shopId`; two-shop isolation tests present and passing.
  - `INV-2` (Encryption & Logging): AES-256-GCM cipher with per-record AAD; S3 SSE-KMS storage; 0 logger statements pass Rx data; error envelopes redact data.
  - `INV-3` (Shopify Rx Leak Prevention): `storeRxInOrder` defaults false; only `_rx_ref` and human summary in cart line item properties; 0 plaintext Rx strings in cart properties.
  - `INV-4` (Integer Money): Minor units int + currency; `parseFloat`/`toFixed` grep finds 0 occurrences on money fields across `app/` and `packages/`.
  - `INV-5` (Diopter Units): Integer hundredths for SPH/CYL/ADD and integer tenths of mm for PD enforced in zod schemas and domain models.
  - `INV-6` (Verification at Boundary): All proxy endpoints authenticate with `authenticate.public.appProxy`; webhooks authenticate with `authenticate.webhook`; request bodies parsed through zod schemas before executing domain logic.
  - `INV-7` (Tokens & Design): Grep `#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms` finds 0 occurrences in `packages/configurator` outside `tokens.css`. Admin routes use Polaris web components with 0 custom CSS or color styles.
  - `INV-8` (Webhooks & Jobs): Webhooks enqueue jobs by ID and return 200 immediately; handlers are idempotent; duplicate job delivery verified in tests.
  - `INV-9` (Storefront Strings): Storefront configurator copy lives in `strings.ts` files; 0 raw JSX text literals in step components.
  - `INV-10` (Redaction Cleanup): `shop/redact` cascades across all Prisma models containing `shopId` (dynamically checked against Prisma DMMF) and cleans S3 `shops/<shopId>/` prefix.
- **2026-11-09** — Structural invariants verification (`ARCHITECTURE.md`):
  - Invariant 1: Routes call services; grep confirms 0 imports of `react-router` in `*.service.server.ts`.
  - Invariant 2: In production code, grep confirms `process.env` appears exclusively in `app/shared/config.server.ts`. (Test file `object-store.server.test.ts` has 13 hits addressed in Spec 35).
  - Invariant 3: Grep confirms `new PrismaClient`, `new S3Client`, `new Resend`, and `new PgBoss` are instantiated exclusively in `app/shared/container/` and all are lazy getters.
  - Invariant 4: `packages/rx-core/package.json` has only `zod` in `dependencies`.
  - Invariant 5: Every route in `routes/proxy.*` and `routes/webhooks.*` verifies signature at invocation start.
  - Invariant 6: Every endpoint is consumed by another spec or by the e2e flow table.
  - Invariant 7: Configurator makes network calls exclusively to `/apps/lens-advisor/*` and Shopify `/cart/*.js`.
- **2026-11-09** — Stubs and wiring verification:
  - Re-read all 33 `## Wiring` sections: all previously stubbed items (e2e suite, proxy routes, compliance handlers, dispatch handler, step folders) are fully implemented. 0 stubs remain in production code.
- **2026-11-09** — Design system token check:
  - Scanned all `--la-*` token references across `packages/configurator`.
  - Finding: `packages/configurator/src/steps/02-prescription/prescription.css:408` uses invalid token `--la-radius-full` instead of canonical `--la-radius-pill`. Done-when box 8 left unticked; follow-up Spec 35 filed.
- **2026-11-09** — CLI tooling check (Step 8):
  - Ran `pnpm exec shopify app deploy --dry-run`: Command "shopify" not found. `@shopify/cli` is not a dependency in `package.json`; per Hard Rule 7 (no machine-level installs), CLI execution is deferred to dev store runner.
- **2026-11-09** — Findings and follow-up specs filed:
  - Filed `specs/35-verification-findings.md` covering:
    1. Replace invalid token `--la-radius-full` with `--la-radius-pill` in `packages/configurator/src/steps/02-prescription/prescription.css`.
    2. Replace direct `process.env` mutations with `vi.stubEnv` in `app/shared/storage/object-store.server.test.ts:577-608`.
  - Added Spec 35 row to `specs/README.md` and `specs/PROGRESS.md`.
- **2026-11-08** — Evidence (orchestro spec verify, tree 3cdb6ce6): install pass · typecheck pass · lint pass · build pass · test pass 1307/0/0
