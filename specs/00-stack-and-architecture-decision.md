# Spec 00 — Stack, storage, testing and design decision

**Status:** Done
**Depends on:** —
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** —
**Reuses:** `../docs/research/stack.md`, `../docs/research/libraries.md`, `../docs/planning/intake.md`
**Kind:** decision
**Invariants:** —

> A decision spec. "Done" means the decisions are recorded; spec 01 confirms the commands run.

## Goal

Settle every choice the MVP spec set is generated against, so no later spec re-decides one halfway.

## Scope

Record the stack, storage, cart, billing, security, testing and design decisions below, what is
out of the MVP, and what is left to a human.

## Decisions

### Stack
**Decided:** Shopify's official **React Router 7** app template (`shopify app init`), TypeScript, pnpm
workspace with `packages/rx-core` (pure TS + zod) and `packages/configurator` (Preact + Vite library
build into the theme app extension's `assets/`). Node ≥ 22.12. Admin UI in **Polaris web components** +
App Bridge React 4.
**Alternatives considered:** Remix template (superseded by React Router 7 — stack.md §1); `@shopify/polaris`
React (deprecated — §2); React or vanilla JS for the storefront (React too heavy for the ~10 KB JS
guidance; vanilla too costly for a 7-step stateful UI — Preact via a tiny loader that lazy-loads the bundle).
**Rationale:** the template carries auth, sessions, webhooks and billing helpers; one domain package
shared by server and storefront keeps Rx rules identical in both.

### Storage and infrastructure
**Decided:** Neon Postgres via Prisma **6.19.x** (pooled `url`, unpooled `directUrl`, `connect_timeout=15`);
AWS S3 with bucket-default SSE-KMS for prescription files and tickets; Resend for email; **pg-boss** job
queue on the same Postgres; Render web service + Render background worker (paid instances).
**Alternatives considered:** SQLite (template default — not multi-instance); Cloudflare R2 (no BAA);
graphile-worker (needs LISTEN/NOTIFY, broken by Neon's pooler); BullMQ (needs Redis).
**Rationale:** intake answers (Render + Neon, S3, Resend) and stack.md §9–10.

### Cart bundling
**Decided:** Shopify **nested cart lines** — frame parent line, lens/priced options/add-ons as child lines
with `parent_id`. Every lens, priced option and add-on is a real Shopify variant created by the app
(spec 17). No Cart Transform function in MVP.
**Alternatives considered:** Cart Transform `linesMerge` (needs an app-owned parent product, per-shop
eligibility, Rust; orders still arrive as components) — post-MVP; separate lines + quantity-sync script
(nested lines remove children with the parent natively).
**Rationale:** intake 2026-11-07 ("Nested lines only"); stack.md §4.

### Billing
**Decided:** Shopify managed App Pricing; the app reads the active subscription and gates the admin
(spec 09). **Alternatives:** Billing API `billing.require/request` (kept only for existing integrations).

### Security and privacy
**Decided:** prescription payloads AES-256-GCM in the DB with per-row AAD (spec 05); `storeRxInOrder`
defaults off so Shopify sees only `_rx_ref` (INV-3); app proxy signature + zod on every storefront call.

### Testing
**Decided:** Vitest everywhere (+ `@testing-library/preact`; template `testConfig()` for routes);
Playwright for the e2e spec only, against a password-protected Shopify dev store storefront, plus
loader/action calls for admin flows (no automated Shopify Admin login).
**Commands (spec 01 confirms):** `pnpm typecheck`, `pnpm lint`, `pnpm vitest run <path>`, `pnpm test`, `pnpm build`
**E2E command (first run by spec 33):** `pnpm test:e2e`

### Design direction
**Source:** design/v3 (approved 2026-11-07) · brand input: **user-supplied — VirtualTry brand system**
(tryon2 `specs/brand/VirtualTry-Brand-System.html`, `virtualtry-latest/app/styles/brand-tokens.css`),
fixed input. Applies to the storefront configurator only; the admin is Polaris.
**Decided:** bone/ink surfaces, one Signal Orange accent used for actions only, Geist on controls, the
offset signature shadow on the single primary button. Tokens: `DESIGN-SYSTEM.md`.

### Out of MVP
**Decided:** these are not in the MVP; later specs that mention them defer here (spec 00):
AI OCR of uploaded prescriptions; a re-encryption job for key rotation; live lab formats and APIs (HOYA XML,
OMA, VisionWeb); usage-based plan limits; a merchant UI for data requests; the Cart Transform merged line;
order edits and cancellations; product-specific catalogs; analytics. Discounts, tax and shipping stay in
Shopify checkout. Listed again in `README.md`.

## Decisions deferred to a human

- Plan names and prices in the Partner Dashboard (blueprint suggests flat $99–$299/mo) → README Open questions.
- Hiding app-created lens/add-on products from collections and search → spec 17 proposes `seo.hidden`; owner confirms on a real store.
- S3 bucket, IAM and KMS key setup → deploy notes, README Open questions.
- Retention for prescriptions never attached to an order → README Open questions.

## Explicit non-scope

- Any implementation → spec 01 onward.
- The full token list → `DESIGN-SYSTEM.md`, which spec 04 builds `tokens.css` from. The folder tree → `ARCHITECTURE.md`, which spec 01 creates.

## Steps

1. Read the intake answers and the research; 2. record each decision with its alternatives; 3. list
what is out of MVP and what is left to a human.

## Done when

- [x] Every decision above has an alternative and a rationale. [static]
- [x] Steering docs, `INVARIANTS.md` and `RULINGS.md` exist and agree with this file. [static]
- [x] Unresolved items are in `README.md` → Open questions. [static]

## Log

- **2026-11-07** — Decided in planning from intake answers and `docs/research/stack.md` (read 2026-11-07).
  Cart bundling switched from Cart Transform to nested cart lines after research; the command box stays
  open until spec 01 runs them.
