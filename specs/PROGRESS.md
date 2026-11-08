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
| 04 | [Configurator package, tokens and theme app block](./04-configurator-package-and-tokens.md) | Not started | 01 | Heavy | — |  |
| 05 | [Field encryption for prescription data](./05-field-encryption.md) | Done | 01 | Heavy | — | PR #24 |
| 06 | [S3 storage adapter](./06-s3-storage.md) | Done | 01 | Standard | — | PR #9 |
| 07 | [Mailer adapter (Resend)](./07-mailer.md) | Done | 01 | Light | — | PR #35 |
| 08 | [Job queue and worker process (pg-boss)](./08-job-queue.md) | Not started | 01 | Standard | — |  |
| 09 | [Plan gate (Shopify managed pricing)](./09-plan-gate.md) | Done | 01 | Standard | — | PR #15 |
| 10 | [Rx parser and validation](./10-rx-parser-validation.md) | Done | 03 | Standard | — | PR #19 |
| 11 | [Rx limits engine](./11-rx-limits-engine.md) | Done | 03 | Standard | — | PR #23 |
| 12 | [Lab code compiler](./12-lab-code-compiler.md) | Not started | 03 | Standard | — |  |
| 13 | [Price calculation](./13-pricing.md) | Done | 03 | Standard | — | PR #30 |
| 14 | [Catalog repository and service](./14-catalog-service.md) | Not started | 02, 03 | Standard | — |  |
| 15 | [Shop settings repository and service](./15-shop-settings-service.md) | Done | 02, 03 | Standard | — | PR #32 |
| 16 | [Configurator shell, state machine and API client](./16-configurator-shell.md) | Not started | 03, 04 | Heavy | — |  |
| 17 | [Shopify product sync for lenses, options and add-ons](./17-shopify-product-sync.md) | Not started | 13, 14 | Standard | — |  |
| 18 | [Admin: lens groups and lenses](./18-admin-lenses.md) | Not started | 09, 10, 12, 13, 14, 17 | Standard | — |  |
| 19 | [Admin: lens options and add-ons](./19-admin-options-addons.md) | Not started | 09, 13, 14, 17 | Standard | — |  |
| 20 | [Admin: settings page](./20-admin-settings.md) | Not started | 09, 15 | Standard | — |  |
| 21 | [App proxy: storefront catalog endpoint](./21-proxy-catalog-endpoint.md) | Not started | 09, 14, 15 | Standard | — |  |
| 22 | [App proxy: prescription submit and upload endpoints](./22-proxy-prescription-endpoints.md) | Not started | 02, 05, 06, 10 | Heavy | — |  |
| 23 | [orders/create webhook → lab orders](./23-orders-webhook.md) | Not started | 02, 08, 11, 22 | Heavy | — |  |
| 24 | [Lab job ticket renderer (PDF and CSV)](./24-lab-ticket-renderer.md) | Not started | 03, 12 | Standard | — |  |
| 25 | [Compliance and uninstall webhooks](./25-compliance-webhooks.md) | Not started | 02, 06, 07, 08 | Heavy | — |  |
| 26 | [Configurator steps 1–2: Rx type and prescription](./26-step-rx-type-and-prescription.md) | Not started | 10, 16 | Standard | — |  |
| 27 | [Configurator steps 3–4: lens group and lens, with Rx limits](./27-step-lens-selection.md) | Not started | 11, 13, 16 | Standard | — |  |
| 28 | [Configurator steps 5–6: options, add-ons and price summary](./28-step-options-addons.md) | Not started | 13, 16 | Standard | — |  |
| 29 | [Configurator step 7: review and add to cart (nested lines)](./29-step-review-add-to-cart.md) | Not started | 13, 16, 28 | Heavy | — |  |
| 30 | [Lab order dispatch job (ticket → S3 → email)](./30-lab-order-dispatch.md) | Not started | 05, 06, 07, 14, 15, 23, 24 | Heavy | — |  |
| 31 | [Admin home and setup checklist](./31-admin-home-setup.md) | Not started | 09, 14, 15 | Light | — |  |
| 32 | [Admin: lab orders list, resend and ticket download](./32-admin-lab-orders.md) | Not started | 06, 09, 30 | Standard | — |  |
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
