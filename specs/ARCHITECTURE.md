# Architecture

Shopify embedded app (React Router 7 template) + a pure-TypeScript domain package shared with a Preact
storefront configurator shipped in a theme app extension. One Node web service and one Node worker on
Render, Postgres on Neon, prescription files in S3, email through Resend. Decisions and alternatives:
`00-stack-and-architecture-decision.md`. Sources: `../docs/research/stack.md`, `libraries.md`.

## Folder structure

```
lens-advisor/
  app/                              React Router app (Shopify template)
    root.tsx · entry.server.tsx      template files (protected, see below)
    shopify.server.ts                shopApp config, auth, webhooks registration (spec 01 owns)
    worker.server.ts                 worker entry: starts pg-boss, registers every features/*/jobs.server.ts (spec 08)
    routes/                          flat file routes — one file per URL, added by feature specs
      app.tsx                        embedded admin layout; builds <s-app-nav> from features/*/nav.ts (spec 01)
      app._index.tsx                 admin home / setup checklist (spec 31)
      app.lenses*.tsx                lens groups + lenses (spec 18)
      app.options*.tsx               option groups, values, add-ons (spec 19)
      app.settings.tsx               shop settings (spec 20)
      app.lab-orders*.tsx            lab orders (spec 32)
      proxy.catalog.ts               GET storefront catalog (spec 21)
      proxy.prescriptions.ts         POST prescription; proxy.upload-url.ts POST presign (spec 22)
      webhooks.orders.create.ts      (spec 23)
      webhooks.compliance.ts · webhooks.app.uninstalled.ts   (spec 25)
    features/<feature>/              one folder per feature
      *.repository.server.ts         Prisma access, every function takes shopId first
      *.service.server.ts            business logic, plain values in/out, deps via factory
      schema.ts                      zod shapes for this feature's forms/bodies
      jobs.server.ts                 (optional) job handlers, discovered by the worker
      nav.ts                         (optional) admin nav entry, discovered by app.tsx
      components/                    Polaris web-component pieces for this feature's routes
    shared/
      config.server.ts               the only reader of process.env; zod-validated (spec 01)
      container/<name>.server.ts     one lazy getter per dependency: prisma (01), cipher (05), object-store (06),
                                     mailer (07), queue (08) — the composition root, split so nobody shares a file
      crypto/ storage/ mail/ queue/  infrastructure adapters (specs 05–08)
      http/errors.server.ts          error classes + one JSON error responder (spec 01)
  packages/
    rx-core/src/                     pure TS, no Node or DOM APIs: types, schemas, rx parse/validate,
                                     limits, lab-code, pricing, format, cart bundle properties (03, 10–13)
    configurator/                    Preact + Vite library build → one flat file per entry in
      src/entries/*.ts               extensions/lens-configurator/assets/ (spec 04)
      src/shell/                     <lens-configurator> custom element, state reducer, api client (spec 16)
      src/steps/<nn-name>/           one folder per step, discovered by the shell (specs 26–29)
      src/styles/tokens.css          the only file with raw design values (spec 04)
  extensions/lens-configurator/      theme app extension
    blocks/select-lenses.liquid      app block: button + mount point + product JSON (spec 04)
    assets/                          build output only — never edited by hand
    locales/                         block settings strings
  prisma/schema.prisma · migrations/ (spec 02)
  e2e/ · playwright.config.ts        (spec 33 only)
```

## Hot files — designed out

| Hot file | Pattern | Owner |
|---|---|---|
| Admin nav | `app.tsx` globs `app/features/*/nav.ts` (eager `import.meta.glob`), sorts by `order` | 01 creates; features add `nav.ts` |
| Worker job registry | `worker.server.ts` globs `app/features/*/jobs.server.ts` | 08 creates; 23, 25, 30 add files |
| Configurator steps | shell globs `src/steps/*/index.tsx`, orders by folder prefix `01-`…`07-` | 16 creates; 26–29 add folders |
| Vite entries | `packages/configurator/vite.config.ts` builds every `src/entries/*.ts` | 04 |
| Routes | file-system flat routes — new URL = new file | no owner |
| Composition root | No central container file. `app/shared/container/<name>.server.ts` holds one lazy getter (`getPrisma()`, `getCipher()`, `getObjectStore()`, `getMailer()`, `getQueue()`), each owned by the spec that builds that adapter. Services receive dependencies through their factory; only route modules and `worker.server.ts` call the getters | 01, 05–08 |
| `config.server.ts` | Spec 01 declares every MVP env var up front (see `.env.example`) | 01 |
| `shopify.app.toml` | Spec 01 declares scopes, app proxy, every webhook subscription and compliance topics up front | 01 |
| `prisma/schema.prisma` | Spec 02 writes every MVP model in one migration | 02 |
| Strings | configurator: per-step `strings.ts`; admin: inline in route files (Polaris) | per spec |

## Layer boundaries

| Path | Owns | Must never |
|---|---|---|
| `app/routes/*` | auth call (`authenticate.admin/webhook/public.appProxy`), parse input with zod, call one service, shape response | contain business rules, call Prisma, read `process.env` |
| `app/features/*/*.service.server.ts` | business rules | import from `react-router`, touch `Request`/`Response` |
| `app/features/*/*.repository.server.ts` | Prisma queries | run a query without `shopId` (INV-1); return Prisma rows past the service (map to DTOs) |
| `app/shared/*` adapters | one external system each | know about features |
| `packages/rx-core` | pure domain logic | import Node, DOM, Prisma, Shopify or Preact |
| `packages/configurator` | storefront UI | import from `app/`; call anything but the app proxy and Shopify's Cart AJAX API |
| `extensions/*/assets` | build output | be hand-edited |

## Naming

kebab-case files; `*.server.ts` for server-only modules (template convention); tests next to code as
`*.test.ts(x)`; factories `createXService(deps)`; React Router route files follow the template's flat
route naming. Prisma models PascalCase, tables via `@@map` snake_case.

## Protected files

`app/root.tsx`, `app/entry.server.tsx`, `app/routes/auth.*`, template `Session` model — template code,
change only when a spec says so. `prisma/migrations/*` — never edit an applied migration; add a new one.
`extensions/lens-configurator/assets/*` — generated.

## Data model

Money fields `*Minor` int + `currency`; diopters int hundredths; `archivedAt` soft delete on catalog rows.

| Model | Fields (intent) |
|---|---|
| `Session` | template |
| `Shop` | `id`, `domain` unique, `installedAt`, `uninstalledAt?` |
| `ShopSettings` | `shopId` PK; `labEmails[]`; `ticketFormat` PDF/CSV/BOTH; `storeRxInOrder` default false; `rxUploadEnabled`; `manualRxEnabled` |
| `LensGroup` | `shopId`, `name`, `description`, `position`, `archivedAt?` |
| `Lens` | `shopId`, `groupId`, `name`, `description`, `priceMinor`, `currency`, `rxTypes[]`, `sphMin/sphMax`, `cylMin/cylMax`, `addMin?/addMax?`, `labCodeTemplate`, `shopifyProductId?`, `shopifyVariantId?`, `position`, `archivedAt?` |
| `OptionGroup` | `shopId`, `kind` MATERIAL/TINT_TYPE/COLOR, `name`, `position`, `archivedAt?` |
| `OptionValue` | `shopId`, `optionGroupId`, `label`, `priceDeltaMinor`, `tokenKey?`, `tokenValue?`, `overrideCode?`, `swatch?` (a DESIGN-SYSTEM-independent merchant colour, stored as data), `shopifyVariantId?` (only when delta > 0), `position`, `archivedAt?` |
| `AddOn` | `shopId`, `name`, `priceMinor`, `currency`, `shopifyProductId?`, `shopifyVariantId?`, `position`, `archivedAt?` |
| `Prescription` | `shopId`, `rxType`, `source` MANUAL/UPLOAD, `cipher` (spec 05 token, AAD `shopId:id`), `uploadKeys[]`, `createdAt`, `orderId?` |
| `LabOrder` | `shopId`, `shopifyOrderId`, `orderName`, `bundleId`, `prescriptionId?`, `lensId`, `optionValueIds[]`, `addOnIds[]`, `frameTitle`, `frameSku?`, `rxOutOfLimits`, `status` PENDING/SENDING/SENT/FAILED, `attempts`, `lastErrorCode?`, `ticketKeys[]`, `providerId?`, `sentAt?`, `createdAt`; unique (`shopId`,`shopifyOrderId`,`bundleId`) |
| `ComplianceRequest` | `shopId`, `topic`, `shopifyRequestId` unique, `receivedAt`, `handledAt?` |

pg-boss keeps its own tables in schema `pgboss`; Prisma does not manage them.

S3 key layout (spec 06): `shops/<shopId>/rx/<prescriptionId>/<uuid>.<ext>`, `shops/<shopId>/tickets/<labOrderId>.<pdf|csv>`.

## State ownership

- Admin: server state comes from React Router loaders/actions (no client cache library); form drafts in
  component state. No global store.
- Configurator: one `useReducer` state machine in the shell (spec 16) — current step, selection, validated
  prescription, catalog response; steps receive state + dispatch as props. No context except the API
  client (dependency injection). Catalog fetched once per open.
- Server: no in-memory state across requests; the queue and Postgres are the only shared state.

## Errors

JSON error body everywhere: `{ "error": { "code": "<UPPER_SNAKE>", "message": "<safe text>" } }` with
401 (verification failed), 400 (validation; may add `fields: [{ path, code }]`), 404, 409, 429, 500.
`app/shared/http/errors.server.ts` (spec 01) defines `AppError(status, code)` and the one responder;
routes throw, the responder renders. Messages never include Rx values (INV-2).

## Test data

Unit tests needing Postgres use `TEST_DATABASE_URL` (a local Postgres 16; spec 01 documents how to get
one) and create a fresh schema per test file, applying migrations with `prisma migrate deploy`; tests
never share rows. Fixtures live in `test/fixtures/` per feature and are named as fixtures. The e2e spec
(33) seeds through the services, not through SQL.

## Invariants — structural

1. Routes call services; services never import `react-router` (grep).
2. `process.env` appears only in `app/shared/config.server.ts` (grep).
3. Nothing constructs `PrismaClient`, an S3 client, a Resend client or pg-boss outside `app/shared/container/`; nothing is constructed at import time (getters are lazy).
4. `packages/rx-core` has zero runtime dependencies other than `zod` (check `package.json`).
5. Every route under `routes/proxy.*` starts with `authenticate.public.appProxy`; every `routes/webhooks.*`
   with `authenticate.webhook` (INV-6).
6. Every endpoint created by a spec is consumed by another spec or by the e2e flow table.
7. The configurator talks only to `/apps/lens-advisor/*` (app proxy) and `/cart/*.js`.
