# LensAdvisor MVP — progress tracker

The single source of truth for "where are we". Under Orchestro the **lead** writes the `Status` and
`Notes` cells when it merges a spec's PR — coders do not edit this table, because parallel edits to one
table conflict. Under `spec-run` the session updates it in the same pass as the spec file.

| # | Spec | Status | Depends on | Model | Issue | Notes |
|---|------|--------|------------|-------|-------|-------|
| 00 | [Stack, storage, testing and design decision](./00-stack-and-architecture-decision.md) | Done | — | Heavy | — | Decided in planning |
| 01 | [App scaffold, workspace and unit harness](./01-scaffold.md) | Done | 00 | Heavy | — | PR #5 |
| 02 | [Database schema and first migration](./02-database-schema.md) | Done | 01 | Heavy | — | PR #16 |
| 03 | [rx-core domain types and schemas](./03-rx-core-contracts.md) | Done | 01 | Heavy | — | PR #14 |
| 04 | [Configurator package, tokens and theme app block](./04-configurator-package-and-tokens.md) | Done | 01 | Heavy | — | PR #22 |
| 05 | [Field encryption for prescription data](./05-field-encryption.md) | Done | 01 | Heavy | — | PR #24 |
| 06 | [S3 storage adapter](./06-s3-storage.md) | Done | 01 | Standard | — | PR #9 |
| 07 | [Mailer adapter (Resend)](./07-mailer.md) | Done | 01 | Light | — | PR #35 |
| 08 | [Job queue and worker process (pg-boss)](./08-job-queue.md) | Done | 01 | Standard | — | PR #17 |
| 09 | [Plan gate (Shopify managed pricing)](./09-plan-gate.md) | Done | 01 | Standard | — | PR #15 |
| 10 | [Rx parser and validation](./10-rx-parser-validation.md) | Done | 03 | Standard | — | PR #19 |
| 11 | [Rx limits engine](./11-rx-limits-engine.md) | Done | 03 | Standard | — | PR #23 |
| 12 | [Lab code compiler](./12-lab-code-compiler.md) | Done | 03 | Standard | — | PR #28 |
| 13 | [Price calculation](./13-pricing.md) | Done | 03 | Standard | — | PR #30 |
| 14 | [Catalog repository and service](./14-catalog-service.md) | Done | 02, 03 | Standard | — | PR #31 |
| 15 | [Shop settings repository and service](./15-shop-settings-service.md) | Done | 02, 03 | Standard | — | PR #32 |
| 16 | [Configurator shell, state machine and API client](./16-configurator-shell.md) | Done | 03, 04 | Heavy | — | PR #43 |
| 17 | [Shopify product sync for lenses, options and add-ons](./17-shopify-product-sync.md) | Done | 13, 14 | Standard | — | PR #46 |
| 18 | [Admin: lens groups and lenses](./18-admin-lenses.md) | Done | 09, 10, 12, 13, 14, 17 | Standard | — | PR #57 |
| 19 | [Admin: lens options and add-ons](./19-admin-options-addons.md) | Done | 09, 13, 14, 17 | Standard | — | PR #56 |
| 20 | [Admin: settings page](./20-admin-settings.md) | Done | 09, 15 | Standard | — | PR #38 |
| 21 | [App proxy: storefront catalog endpoint](./21-proxy-catalog-endpoint.md) | Done | 09, 14, 15 | Standard | — | PR #47 |
| 22 | [App proxy: prescription submit and upload endpoints](./22-proxy-prescription-endpoints.md) | Done | 02, 05, 06, 10 | Heavy | — | PR #40 |
| 23 | [orders/create webhook → lab orders](./23-orders-webhook.md) | Done | 02, 08, 11, 22 | Heavy | — | PR #58 |
| 24 | [Lab job ticket renderer (PDF and CSV)](./24-lab-ticket-renderer.md) | Done | 03, 12 | Standard | — | PR #41 |
| 25 | [Compliance and uninstall webhooks](./25-compliance-webhooks.md) | Done | 02, 06, 07, 08 | Heavy | — | PR #50 |
| 26 | [Configurator steps 1–2: Rx type and prescription](./26-step-rx-type-and-prescription.md) | Done | 10, 16 | Standard | — | PR #67 |
| 27 | [Configurator steps 3–4: lens group and lens, with Rx limits](./27-step-lens-selection.md) | Done | 11, 13, 16 | Standard | — | PR #66 |
| 28 | [Configurator steps 5–6: options, add-ons and price summary](./28-step-options-addons.md) | Done | 13, 16 | Standard | — | PR #65 |
| 29 | [Configurator step 7: review and add to cart (nested lines)](./29-step-review-add-to-cart.md) | Done | 13, 16, 28 | Heavy | — | PR #71 |
| 30 | [Lab order dispatch job (ticket → S3 → email)](./30-lab-order-dispatch.md) | Done | 05, 06, 07, 14, 15, 23, 24 | Heavy | — | PR #61 |
| 31 | [Admin home and setup checklist](./31-admin-home-setup.md) | Done | 09, 14, 15 | Light | — | PR #52 |
| 32 | [Admin: lab orders list, resend and ticket download](./32-admin-lab-orders.md) | Done | 06, 09, 30 | Standard | — | PR #70 |
| 33 | [End-to-end suite](./33-e2e-suite.md) | Not started | 18, 19, 20, 21, 22, 25, 26, 27, 29, 31, 32 | Heavy | — | Only spec with e2e |
| 34 | [Verification pass](./34-verification-pass.md) | Not started | 33 | Heavy | — | Final gate |

`Notes` is a **one-line pointer**, not a summary — the real detail lives in each spec's own Log. `Model`
is the tier from the spec's own `**Model:**` line. `Issue` is `—` until a session opens the GitHub issue,
then `#<n>` — and it must match the spec header.

## Status legend

Not started · In progress · Blocked · Done

## Log

- **2026-11-07** — Spec set planned from `../lensadvisor_blueprint.html` (MVP only). Intake: brand =
  VirtualTry brand system (changed from "Open" mid-planning), Render + Neon, AWS S3, Resend, nested cart
  lines. 35 specs (00–34) in 10 waves, widest wave 9. The chat estimate of 20–24 specs was low: splitting
  each feature into contract → service → endpoint → UI, plus 4 infrastructure adapters and the
  compliance webhooks Shopify requires, gave 35. Cart Transform dropped in favour of nested cart lines
  (two specs removed). Spec 00 marked Done in planning.
- **2026-11-07** — Design pipeline finished (`../design/v1–v3`, VirtualTry brand). The owner approved v3,
  including two brand deviations: `--la-control-edge` (#898578) for 3:1 control edges, and an ink focus
  outline on non-input controls. `DESIGN-SYSTEM.md` transcribed from v3. Validator: 35 specs · 0 errors ·
  34 warnings, all accepted in README → Known gaps (`../docs/planning/validator.md`).
- **2026-11-07** — Spec 01 merged (PR #5).
- **2026-11-07** — Spec 06 merged (PR #9).
- **2026-11-07** — Spec 09 merged (PR #15).
- **2026-11-07** — Spec 03 merged (PR #14).
- **2026-11-07** — Spec 02 merged (PR #16).
- **2026-11-07** — Spec 10 merged (PR #19).
- **2026-11-07** — Spec 11 merged (PR #23).
- **2026-11-07** — Spec 13 merged (PR #30).
- **2026-11-07** — Spec 15 merged (PR #32).
- **2026-11-07** — Spec 05 merged (PR #24).
- **2026-11-07** — Spec 07 merged (PR #35).
- **2026-11-08** — Spec 12 merged (PR #28).
- **2026-11-08** — Spec 04 merged (PR #22, merged by the owner on GitHub after the commit-author refusal).
- **2026-11-08** — Spec 14 merged (PR #31).
- **2026-11-08** — Spec 08 merged (PR #17).
- **2026-11-08** — Spec 21 merged (PR #47).
- **2026-11-08** — Spec 20 merged (PR #38).
- **2026-11-08** — Spec 24 merged (PR #41).
- **2026-11-08** — Spec 17 merged (PR #46).
- **2026-11-08** — Spec 22 merged (PR #40).
- **2026-11-08** — Spec 25 merged (PR #50).
- **2026-11-08** — Spec 31 merged (PR #52).
- **2026-11-08** — Spec 23 merged (PR #58).
- **2026-11-08** — Spec 16 merged (PR #43).
- **2026-11-08** — Spec 18 merged (PR #57).
- **2026-11-08** — Spec 19 merged (PR #56).
- **2026-11-08** — Spec 30 merged (PR #61).
- **2026-11-08** — Spec 28 merged (PR #65).
- **2026-11-08** — Spec 27 merged (PR #66).
- **2026-11-08** — Spec 26 merged (PR #67).
- **2026-11-08** — Spec 32 merged (PR #70).
- **2026-11-08** — Spec 29 merged (PR #71).
