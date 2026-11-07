# DAG — every edge and what it consumes (2026-11-07, 35-spec numbering)

Generated from each spec's `Depends on` and `Reuses` lines. Rewritten after Cart Transform and
cart-sync were dropped (old 37-spec draft superseded).

| Spec | Depends on | Consumes (Reuses) |
|---|---|---|
| 00 | — | `../docs/research/stack.md`, `../docs/research/libraries.md`, `../docs/planning/intake.md` |
| 01 | 00 | `00-stack-and-architecture-decision.md`, `ARCHITECTURE.md`, `../docs/research/stack.md` |
| 02 | 01 | `ARCHITECTURE.md#data-model`, `app/shared/container/prisma.server.ts` (spec 01) |
| 03 | 01 | `packages/rx-core/package.json` (spec 01), `ARCHITECTURE.md#data-model` |
| 04 | 01 | `DESIGN-SYSTEM.md`, `design/v3/product.html`, `../docs/research/stack.md` |
| 05 | 01 | `app/shared/config.server.ts` (spec 01) |
| 06 | 01 | `app/shared/config.server.ts` (spec 01) |
| 07 | 01 | `app/shared/config.server.ts` (spec 01) |
| 08 | 01 | `app/shared/config.server.ts` (spec 01), `../docs/research/libraries.md` |
| 09 | 01 | `app/shopify.server.ts` (spec 01), `app/shared/http/` (spec 01), `../docs/research/stack.md` |
| 10 | 03 | `packages/rx-core/src/index.ts` (spec 03), `packages/rx-core/src/format/` (spec 03) |
| 11 | 03 | `packages/rx-core/src/index.ts` (spec 03), `packages/rx-core/src/format/` (spec 03) |
| 12 | 03 | `packages/rx-core/src/index.ts` (spec 03) |
| 13 | 03 | `packages/rx-core/src/index.ts` (spec 03) |
| 14 | 02, 03 | `prisma/schema.prisma` (spec 02), `test/db.ts` (spec 02), `packages/rx-core/src/schemas/` (spec 03) |
| 15 | 02, 03 | `prisma/schema.prisma` (spec 02), `test/db.ts` (spec 02) |
| 16 | 03, 04 | `packages/rx-core/src/index.ts` (spec 03), `packages/configurator/src/styles/` (spec 04), `packages/configurator/src/test/` (spec 04), `design/v3/product.html`, `DESIGN-SYSTEM.md#layout-conventions`, `DESIGN-SYSTEM.md#states-and-motion` |
| 17 | 13, 14 | `app/features/catalog/catalog.service.server.ts` (spec 14), `app/shopify.server.ts` (spec 01) |
| 18 | 09, 10, 12, 13, 14, 17 | `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/product-sync/` (spec 17), `packages/rx-core/src/lab-code/` (spec 12), `packages/rx-core/src/rx/parse.ts` (spec 10), `packages/rx-core/src/format/` (spec 03), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01) |
| 19 | 09, 13, 14, 17 | `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/product-sync/` (spec 17), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01) |
| 20 | 09, 15 | `app/features/settings/settings.service.server.ts` (spec 15), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01) |
| 21 | 09, 14, 15 | `app/features/billing/` (spec 09), `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/settings/settings.service.server.ts` (spec 15), `packages/rx-core/src/schemas/` (spec 03), `app/shopify.server.ts` (spec 01), `app/shared/http/` (spec 01) |
| 22 | 02, 05, 06, 10 | `packages/rx-core/src/rx/validate.ts` (spec 10), `packages/rx-core/src/schemas/` (spec 03), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/container/object-store.server.ts` (spec 06), `test/db.ts` (spec 02), `app/shopify.server.ts` (spec 01) |
| 23 | 02, 08, 11, 22 | `packages/rx-core/src/cart/bundle-properties.ts` (spec 03), `packages/rx-core/src/limits/` (spec 11), `app/features/prescriptions/` (spec 22), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/queue/` (spec 08), `app/shopify.server.ts` (spec 01) |
| 24 | 03, 12 | `packages/rx-core/src/lab-code/` (spec 12), `packages/rx-core/src/format/` (spec 03), `packages/rx-core/src/index.ts` (spec 03) |
| 25 | 02, 06, 07, 08 | `app/shared/container/object-store.server.ts` (spec 06), `app/shared/container/mailer.server.ts` (spec 07), `app/shared/queue/` (spec 08), `test/db.ts` (spec 02), `app/shopify.server.ts` (spec 01) |
| 26 | 10, 16 | `packages/configurator/src/shell/` (spec 16), `packages/configurator/src/shared/` (spec 16), `packages/rx-core/src/rx/parse.ts` (spec 10), `packages/rx-core/src/rx/validate.ts` (spec 10), `design/v3/product.html`, `design/v3/prescription.html`, `DESIGN-SYSTEM.md#component-conventions` |
| 27 | 11, 13, 16 | `packages/configurator/src/shell/` (spec 16), `packages/rx-core/src/limits/` (spec 11), `packages/rx-core/src/pricing/` (spec 13), `packages/rx-core/src/format/` (spec 03), `design/v3/lenses.html`, `DESIGN-SYSTEM.md#component-conventions` |
| 28 | 13, 16 | `packages/configurator/src/shell/` (spec 16), `packages/configurator/src/shared/` (spec 16), `packages/rx-core/src/pricing/` (spec 13), `design/v3/options.html`, `DESIGN-SYSTEM.md#component-conventions` |
| 29 | 13, 16, 28 | `packages/rx-core/src/cart/bundle-properties.ts` (spec 03), `packages/rx-core/src/pricing/` (spec 13), `packages/configurator/src/price-summary/` (spec 28), `packages/configurator/src/shell/` (spec 16), `design/v3/review.html`, `DESIGN-SYSTEM.md#component-conventions` |
| 30 | 05, 06, 07, 14, 15, 23, 24 | `app/features/lab-orders/lab-orders.repository.server.ts` (spec 23), `app/features/lab-orders/jobs.server.ts` (spec 23), `app/features/lab-orders/ticket/` (spec 24), `app/shared/container/cipher.server.ts` (spec 05), `app/shared/container/object-store.server.ts` (spec 06), `app/shared/container/mailer.server.ts` (spec 07), `app/shared/queue/` (spec 08), `app/features/settings/settings.service.server.ts` (spec 15), `app/features/catalog/catalog.repository.server.ts` (spec 14) |
| 31 | 09, 14, 15 | `app/features/billing/` (spec 09), `app/features/catalog/catalog.service.server.ts` (spec 14), `app/features/settings/settings.service.server.ts` (spec 15), `app/routes/app.tsx` (spec 01) |
| 32 | 06, 09, 30 | `app/features/lab-dispatch/` (spec 30), `app/shared/container/object-store.server.ts` (spec 06), `app/features/billing/` (spec 09), `app/shared/nav/` (spec 01) |
| 33 | 18, 19, 20, 21, 22, 25, 26, 27, 29, 31, 32 | `ARCHITECTURE.md#test-data`, `test/db.ts` (spec 02), `AGENT-GUIDE.md` |
| 34 | 33 | `INVARIANTS.md`, `ARCHITECTURE.md`, `DESIGN-SYSTEM.md`, `INVENTORY.md` |

Removed as ordering-by-habit:
- 21 → 17: the catalog endpoint returns Shopify variant ids stored on catalog rows by 02's schema; 17 only fills them. Tests seed them.
- 26–29 → 21/22: configurator steps call the proxy through 16's API client, faked in unit tests; spec 33 proves the real pairing.
- 24 → 05/23: the renderer is pure over a `TicketData` value; loading and decrypting moved to 30, so 24 runs in wave 4 instead of 6.
- 31 → 18/20: the checklist reads counts through services 14 and 15, not through the admin pages.

Critical path (10 waves): 00 → 01 → 03 → 10 → 22 → 23 → 30 → 32 → 33 → 34.
