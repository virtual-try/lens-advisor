# Features → specs (2026-11-07, 35-spec numbering)

| MVP feature (brief.md) | Specs |
|---|---|
| 1 Scaffold, multi-tenant auth, Postgres | 00, 01, 02 |
| 2 Encrypted prescriptions | 05 (cipher), 06 (S3), 22 (endpoints) |
| 3 Admin: catalog + pricing | 14 (service), 17 (Shopify product sync), 18 (lenses UI), 19 (options/add-ons UI) |
| 4 Admin: groups, upgrades, Rx limits | 18, 19 |
| 5 Rx limits engine | 11 |
| 6 Storefront configurator (7 steps) | 04 (package/tokens/block), 16 (shell/state/client), 26 (steps 1–2), 27 (3–4), 28 (5–6), 29 (7 + add to cart), 21 (catalog endpoint) |
| 7 Rx file upload | 06, 22, 26 |
| 8 Cart bundling | 03 (bundle properties), 29 (nested cart lines with `parent_id`) |
| 9 Lab code compiler | 12 |
| 10 Order → job ticket emailed | 23 (webhook), 24 (PDF/CSV), 30 (dispatch job), 32 (admin list), 07 (mailer), 08 (queue) |
| 11 Flat-rate billing | 09 |
| 12 Privacy + uninstall webhooks | 25 |
| 13 Tokens, e2e, verification | 04, 33, 34 |
| (supporting) | 03 rx-core contracts, 10 Rx parser, 13 pricing, 15 settings service, 20 settings UI, 31 setup checklist |

## Splits considered and rejected

- **One "configurator" spec** — rejected: 7 steps + upload + cart = far over 150 lines; the steps fan out in parallel once the shell (16) exists.
- **Crypto + S3 + mailer as one "infrastructure" spec** — rejected: three unrelated external boundaries, three independent test seams.
- **Rx limits inside the catalog service** — rejected: the same engine runs in the browser bundle (27) and on the server (23 flags out-of-limit orders), so it lives in `packages/rx-core`.
- **Pricing inside steps 5–6** — rejected: step 7, the cart and the lab ticket all need the same total.
- **A separate "configurator integration" spec** — not needed: the shell discovers steps from `steps/*/index.tsx`, so each step spec adds files instead of editing a registry.
- **Shopify product sync inside the catalog service** — rejected: Admin GraphQL side effects and retries are a different boundary from DB CRUD.
- **Ticket renderer that also loads and decrypts** — rejected: pure renderers (24) start three waves earlier; loading lives in the dispatch job (30).
- **Cart Transform merge + quantity-sync specs** — dropped after research (intake 2026-11-07, "Nested lines only"): nested cart lines remove children with the parent natively.

## Size note

The assistant estimated "about 20–24 specs" in chat before splitting. Applying the one-boundary rule
produced 37; dropping Cart Transform and cart-sync gave the final 35 (00–34). Same MVP scope, finer
units; about 58% of ai-gallery's 60.
