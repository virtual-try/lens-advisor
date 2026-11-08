# LensAdvisor MVP — spec index

A Shopify embedded app for optical stores: a "Select lenses" configurator on the product page (Rx type →
prescription → lens → options → add-ons → review) that adds the frame and lenses to the cart as nested
lines, an admin for the lens catalog and settings, and a lab job ticket (PDF/CSV) emailed to the shop's
lab for every order. **The MVP boundary:** one catalog per shop, manual or uploaded prescriptions (no
OCR), email-only lab dispatch, Shopify managed pricing. Everything else in `../lensadvisor_blueprint.html`
is out (see spec 00 → Out of MVP).

This folder breaks the work into small, independently workable specs — goal, exact scope, explicit
non-scope, steps, and a done-when checklist each. They are shaped to run **in parallel under Orchestro**:
every spec whose dependencies are done can start at once. Run them sequentially with `spec-run` if you
prefer; `00` is the decision everything else depends on.

- **Design:** [`../design/v3/`](../design/v3/) is the visual source of truth for the storefront
  configurator (v1 gpt-taste → v2 animate → v3 impeccable), in the VirtualTry brand system. The admin
  uses Polaris web components and has no custom design.
- **Research and raw planning:** [`../docs/`](../docs/).
- **Size:** 39 specs (00–38), about 65% of ai-gallery's 60.

Track progress in [PROGRESS.md](./PROGRESS.md).

## Steering docs — read before any spec

| Doc | What it settles |
|---|---|
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | How to work here: read order, one spec per session, verification bar |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Folder tree, layer boundaries, data model, hot files |
| [INVARIANTS.md](./INVARIANTS.md) | Cross-cutting rules with IDs (`INV-1`…`INV-10`) — each spec lists the ones it touches |
| [RULINGS.md](./RULINGS.md) | Review severity guide and the lead's rulings — reviewers read it first |
| [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) | The closed `--la-*` token list for the configurator, transcribed from `design/v3` |
| [INVENTORY.md](./INVENTORY.md) | What already exists — check it, and `inventory/`, before creating anything |

## Spec list

`Wave` is the parallel round a spec runs in: every spec in a wave depends only on earlier waves, so all
of them can be dispatched at once. Every spec proves itself with unit tests; end-to-end tests are written
and run once, in spec 33. `Model` is the tier; per-provider ids are on each spec's `**Model:**` line.

| # | Spec | Wave | Model | What it covers |
|---|---|---|---|---|
| 00 | [Stack, storage, testing and design decision](./00-stack-and-architecture-decision.md) | 0 | Heavy | Stack, storage, cart bundling, billing, security, testing, design direction, out-of-MVP list. Read first. |
| 01 | [App scaffold, workspace and unit harness](./01-scaffold.md) | 1 | Heavy | React Router 7 Shopify template, pnpm workspace, config, error responder, nav glob, unit harness, render.yaml |
| 02 | [Database schema and first migration](./02-database-schema.md) | 2 | Heavy | Every MVP Prisma model in one migration; per-test-file schema helper |
| 03 | [rx-core domain types and schemas](./03-rx-core-contracts.md) | 2 | Heavy | Shared types, zod schemas, diopter/money formatters, cart bundle line properties |
| 04 | [Configurator package, tokens and theme app block](./04-configurator-package-and-tokens.md) | 2 | Heavy | Preact + Vite library build, `--la-*` tokens, theme app block and ≤10 KB loader |
| 05 | [Field encryption for prescription data](./05-field-encryption.md) | 2 | Heavy | AES-256-GCM field cipher with key ids and per-row AAD |
| 06 | [S3 storage adapter](./06-s3-storage.md) | 2 | Standard | S3 presigned uploads/downloads, SSE-KMS puts, delete by prefix |
| 07 | [Mailer adapter (Resend)](./07-mailer.md) | 2 | Light | Resend mailer with attachments and idempotency keys |
| 08 | [Job queue and worker process (pg-boss)](./08-job-queue.md) | 2 | Standard | pg-boss queue, `defineJob`, worker discovery, retries and dead letters |
| 09 | [Plan gate (Shopify managed pricing)](./09-plan-gate.md) | 2 | Standard | Managed-pricing subscription check and admin gate |
| 10 | [Rx parser and validation](./10-rx-parser-validation.md) | 3 | Standard | Diopter text parsing and cross-field prescription validation |
| 11 | [Rx limits engine](./11-rx-limits-engine.md) | 3 | Standard | Lens limits check with cylinder transposition and structured reasons |
| 12 | [Lab code compiler](./12-lab-code-compiler.md) | 3 | Standard | Lab-code template validation and compilation |
| 13 | [Price calculation](./13-pricing.md) | 3 | Standard | Integer-money price totals; money text parse/format for Shopify |
| 14 | [Catalog repository and service](./14-catalog-service.md) | 3 | Standard | Catalog repository and service (groups, lenses, options, add-ons) |
| 15 | [Shop settings repository and service](./15-shop-settings-service.md) | 3 | Standard | Shop settings repository and service |
| 16 | [Configurator shell, state machine and API client](./16-configurator-shell.md) | 3 | Heavy | `<lens-configurator>` custom element, reducer, step discovery, proxy API client |
| 17 | [Shopify product sync for lenses, options and add-ons](./17-shopify-product-sync.md) | 4 | Standard | Create/update/archive Shopify products and variants for lenses, options, add-ons |
| 18 | [Admin: lens groups and lenses](./18-admin-lenses.md) | 5 | Standard | Admin pages for lens groups and lenses with limits and lab codes |
| 19 | [Admin: lens options and add-ons](./19-admin-options-addons.md) | 5 | Standard | Admin pages for option groups, values and add-ons |
| 20 | [Admin: settings page](./20-admin-settings.md) | 4 | Standard | Admin settings: lab emails, ticket format, Rx options, store-Rx-in-order |
| 21 | [App proxy: storefront catalog endpoint](./21-proxy-catalog-endpoint.md) | 4 | Standard | `GET /apps/lens-advisor/catalog` for the storefront |
| 22 | [App proxy: prescription submit and upload endpoints](./22-proxy-prescription-endpoints.md) | 4 | Heavy | Encrypted prescription submit and presigned upload URL endpoints |
| 23 | [orders/create webhook → lab orders](./23-orders-webhook.md) | 5 | Heavy | orders/create → LabOrder rows per bundle, limits flag, dispatch job queued |
| 24 | [Lab job ticket renderer (PDF and CSV)](./24-lab-ticket-renderer.md) | 4 | Standard | Pure PDF and CSV ticket renderers |
| 25 | [Compliance and uninstall webhooks](./25-compliance-webhooks.md) | 3 | Heavy | customers/data_request, customers/redact, shop/redact, app/uninstalled |
| 26 | [Configurator steps 1–2: Rx type and prescription](./26-step-rx-type-and-prescription.md) | 4 | Standard | Steps 1–2: Rx type, manual entry grid, upload |
| 27 | [Configurator steps 3–4: lens group and lens, with Rx limits](./27-step-lens-selection.md) | 4 | Standard | Steps 3–4: lens group and lens, unavailable lenses with reasons |
| 28 | [Configurator steps 5–6: options, add-ons and price summary](./28-step-options-addons.md) | 4 | Standard | Steps 5–6: options, add-ons, `PriceSummary` |
| 29 | [Configurator step 7: review and add to cart (nested lines)](./29-step-review-add-to-cart.md) | 5 | Heavy | Step 7: review and nested-line add to cart with rollback |
| 30 | [Lab order dispatch job (ticket → S3 → email)](./30-lab-order-dispatch.md) | 6 | Heavy | Dispatch job: load + decrypt, render, store ticket, email lab, status |
| 31 | [Admin home and setup checklist](./31-admin-home-setup.md) | 4 | Light | Admin home setup checklist |
| 32 | [Admin: lab orders list, resend and ticket download](./32-admin-lab-orders.md) | 7 | Standard | Admin lab orders list, detail, resend, ticket download |
| 33 | [End-to-end suite](./33-e2e-suite.md) | 8 | Heavy | Installs Playwright, one test per flow (server + dev-store storefront), runs them. |
| 34 | [Verification pass](./34-verification-pass.md) | 9 | Heavy | Final gate: clean build, both suites, every done-when re-checked, duplication sweep. |
| 35 | [Configurator design token fix](./35-tokens-css.md) | 10 | Light | Replace invalid token --la-radius-full with --la-radius-pill in prescription.css |
| 36 | [Storage test process.env isolation](./36-storage-test-env.md) | 10 | Light | Replace literal process.env in object-store.server.test.ts with vi.stubEnv |
| 37 | [Lab order dispatch tenancy scoping](./37-lab-order-tenancy.md) | 10 | Standard | Require `{ shopId, labOrderId }` in dispatch job and scope getLabOrderShopId by `{ id, shopId }` (INV-1) |
| 38 | [Webhook payload validation and route persistence decoupling](./38-webhook-hardening.md) | 10 | Standard | Zod-validate webhook payloads, log IDs only (INV-6), and move route persistence behind service |

## Waves

```
W0: 00
W1: 01
W2: 02 03 04 05 06 07 08 09
W3: 10 11 12 13 14 15 16 25
W4: 17 20 21 22 24 26 27 28 31
W5: 18 19 23 29
W6: 30
W7: 32
W8: 33 (e2e)
W9: 34 (verification)
W10: 35 36 37 38
```

Critical path: 00 → 01 → 03 → 10 → 22 → 23 → 30 → 32 → 33 → 34 → 35, 36, 37, 38 (11 waves). Check it against
`orchestro specs graph specs/` — if they disagree, this list is wrong.

## Dependency order

| Spec | Depends on |
|---|---|
| 00 | — |
| 01 | 00 |
| 02 | 01 |
| 03 | 01 |
| 04 | 01 |
| 05 | 01 |
| 06 | 01 |
| 07 | 01 |
| 08 | 01 |
| 09 | 01 |
| 10 | 03 |
| 11 | 03 |
| 12 | 03 |
| 13 | 03 |
| 14 | 02, 03 |
| 15 | 02, 03 |
| 16 | 03, 04 |
| 17 | 13, 14 |
| 18 | 09, 10, 12, 13, 14, 17 |
| 19 | 09, 13, 14, 17 |
| 20 | 09, 15 |
| 21 | 09, 14, 15 |
| 22 | 02, 05, 06, 10 |
| 23 | 02, 08, 11, 22 |
| 24 | 03, 12 |
| 25 | 02, 06, 07, 08 |
| 26 | 10, 16 |
| 27 | 11, 13, 16 |
| 28 | 13, 16 |
| 29 | 13, 16, 28 |
| 30 | 05, 06, 07, 14, 15, 23, 24 |
| 31 | 09, 14, 15 |
| 32 | 06, 09, 30 |
| 33 | 18, 19, 20, 21, 22, 25, 26, 27, 29, 31, 32 |
| 34 | 33 |
| 35 | 34 |
| 36 | 34 |
| 37 | 34 |
| 38 | 34 |

## Status shorthand

- **Not started** — nothing done yet
- **In progress** — actively being worked, or resumed from a stopped session
- **Blocked** — waiting on a decision or another spec
- **Done** — done-when checklist fully checked, and actually verified

## Open questions

- **Plan names and prices** in the Partner Dashboard (blueprint suggests flat $99–$299/mo). Spec 09 only
  reads whether a plan is active.
- **Hiding lens/add-on products** from collections the merchant builds by hand. Spec 17 sets `seo.hidden`;
  confirm behaviour on a real store.
- **Retention** for prescriptions never attached to an order (abandoned configurators).
- **Order edits and cancellations** after a lab order was sent — not handled in MVP.
- **S3 bucket, IAM policy and KMS key** — created by a human before spec 06's `[requires:]` box and
  deployment.
- **Key rotation:** spec 05 supports several key ids; a re-encryption job is out of MVP.
- **Theme block detection** on the admin checklist (spec 31) is a manual tick, not persisted.
- **Design follow-ups** from `../design/v3/NOTES.md`: thickness chosen from a lens-edge picture (needs
  artwork), a one-tap "best match" for strong prescriptions, mobile chrome height (~30% of the viewport,
  needs a real-device check), and whether merchants need more overrides than accent, font and radius.
  The prototype's 129-option SPH select is a stand-in: spec 26 uses text inputs parsed by spec 10.
- **Out of MVP** (spec 00): AI OCR, live lab formats/APIs, usage-based limits, Cart Transform merged line,
  product-specific catalogs, analytics, merchant UI for data requests, bulk import.

## Known gaps

Accepted validator warnings (full output: `../docs/planning/validator.md`):

- *"creates X but no other spec mentions it"* on routes, `.env.example`, `render.yaml`,
  `shopify.app.toml`, `pnpm-workspace.yaml` — these are entry points reached by Shopify, the theme or the
  deploy, not by another spec; each user-facing route is a row in spec 33's flow table.
  The rest (`field-cipher.server.ts`, `settings.repository.server.ts`, `intake.service.server.ts`, form
  components) are internal files reached through a path another spec does cite — the container getter,
  the service, or the route that renders them.
- *"Depends on N is already implied"* — kept deliberately: each listed spec is directly consumed (named in
  `Reuses`), so the edge documents the consumption; it adds no wave.
- *Spec 00 Done with no GitHub issue* — a decision spec, recorded in planning; no PR.
