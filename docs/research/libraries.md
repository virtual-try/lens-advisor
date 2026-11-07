# Libraries: exact package names, versions and exports

Versions come from the npm registry `dist-tags.latest` and publish date, read on **2026-11-07** (`https://registry.npmjs.org/<pkg>`). "Template pin" means the range in `Shopify/shopify-app-template-react-router@main/package.json`, read the same day.

## Shopify

| Package | Latest (date) | Template pin | Key exports / usage | Source |
|---|---|---|---|---|
| `@shopify/shopify-app-react-router` | 4.0.2 (2026-11-06) | `^3.0.1` | `./server`: `shopifyApp`, `ApiVersion`, `AppDistribution`, `BillingInterval`, `boundary`. `./react`: `AppProvider`. `./adapters/node` (side-effect import). `./test-helpers`: `testConfig`. From `shopifyApp()`: `authenticate.admin`, `authenticate.webhook`, `authenticate.public.appProxy`, `authenticate.public.checkout`, `unauthenticated.admin/storefront`, `login`, `registerWebhooks`, `sessionStorage`, `addDocumentResponseHeaders`. 4.x loads Polaris 2 by default; to stay on Polaris 1, set `polarisUrl` on both `AppProvider` and `shopifyApp`. | npm; package.json `exports`; CHANGELOG (github.com/Shopify/shopify-app-js) |
| `@shopify/shopify-app-session-storage-prisma` | 11.0.3 (2026-11-06) | `^11.0.0` | `PrismaSessionStorage` (`new PrismaSessionStorage(prisma)`). Peer deps: `prisma ^6.19.0`, `@prisma/client ^6.19.0`. | npm |
| `@shopify/app-bridge-react` | 4.2.15 (2026-11-05) | `^4.2.4` | `useAppBridge` (toasts, modals, resource picker, save bar) | npm; template `app._index.tsx` |
| `@shopify/polaris-types` | 2.0.0 (2026-10-21) | `1.0.1` (dev) | JSX types for `<s-*>` web components | npm |
| `@shopify/polaris` | 13.9.5 | not used | **DEPRECATED. Do not use.** | npm deprecation message |
| `@shopify/cli` | 5.0.1 (2026-11-04) | n/a | `shopify app init / dev / deploy / generate extension / function run / function typegen / function build`. engines `node >=22.12.0`. | npm |
| `@shopify/api-codegen-preset` | (template) | `^2.0.0` (dev) | GraphQL codegen preset | template |
| `@shopify/shopify_function` | 2.0.1 (2026-01-30) | in the JS function template `^2.0.1` | JS Shopify Functions runtime | npm; extensions-templates `functions-cart-transform-js/package.json.liquid` |
| `@shopify/shopify-function-test-helpers` | n/a | `^1.0.0` (dev, function template) | Fixture-based function tests with Vitest | extensions-templates |

Framework pins in the template: `react-router`, `@react-router/dev`, `@react-router/node`, `@react-router/serve` and `@react-router/fs-routes` at **7.18.2**; `react`/`react-dom` `^18.3.1`; `vite ^7.3.1`; `isbot`; `vite-tsconfig-paths`. Node engines: `>=22.12`.

## Database

| Package | Latest | Use | Notes |
|---|---|---|---|
| `prisma` | **dist-tag `latest` = 8.0.0-rc.33 (prerelease!)**; `prev` = 7.10.1 | CLI | **Pin `6.19.x`** to match session-storage-prisma's peer dependency. Neon's guide warns about the `latest` tag too (https://neon.com/docs/guides/prisma). |
| `@prisma/client` | 7.10.1 (2026-10-15) | Client | **Pin `6.19.x`.** |
| `@prisma/adapter-neon` | 7.10.1 | Neon serverless driver adapter | Prisma 7 only. **Not needed** with Prisma 6 on Render (a long-lived Node process, using the normal TCP driver with the pooled URL). |

Prisma 6 datasource for Neon: `url = env("DATABASE_URL")` (pooled `-pooler` host) and `directUrl = env("DATABASE_URL_UNPOOLED")`.

## Email: Resend

- Package `resend` **6.37.0** (2026-10-30). context7 id `/resend/resend-node`.
- `import { Resend } from 'resend'; const resend = new Resend(process.env.RESEND_API_KEY);`
- `resend.emails.send(payload, { idempotencyKey? })`. The payload takes `from`, `to` (string or string[], max 50), `subject`, one of `html | text | react`, plus optional `cc`, `bcc`, `replyTo`, `headers`, `tags`, `scheduledAt`, and `attachments: Attachment[]`.
- `Attachment = { content?: string(base64) | Buffer | Uint8Array | ArrayBuffer; filename?: string; path?: string /* remote URL */; contentType?: string; contentId?: string /* inline cid: */ }`. **Max 40 MB per email.**
- Returns `{ data: { id }, error }` and does not throw on API errors. Always check `error`.

## Storage: AWS SDK v3 (S3)

- `@aws-sdk/client-s3` **3.1164.0** and `@aws-sdk/s3-request-presigner` **3.1164.0** (both 2026-11-06). context7 id `/aws/aws-sdk-js-v3`.
- Imports: `S3Client`, `PutObjectCommand`, `GetObjectCommand` from `@aws-sdk/client-s3`; `getSignedUrl` from `@aws-sdk/s3-request-presigner`.
- `PutObjectCommand` input: `ServerSideEncryption: "AES256" | "aws:kms" | "aws:kms:dsse" | ...`, `SSEKMSKeyId`, `BucketKeyEnabled`, `ContentType`.
- `getSignedUrl(client, command, { expiresIn, hoistableHeaders?: Set<string>, unhoistableHeaders?: Set<string>, signableHeaders? })`. `x-amz-*` headers are not hoisted by default, so the uploader must send them unless they are listed in `hoistableHeaders`.
- Recommended pattern: bucket default encryption SSE-KMS (or rely on the mandatory SSE-S3 baseline that has applied since 2023-01-05: https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html), with no SSE headers in the presigned PUT.

## PDF

| Package | Latest (date) | Verdict |
|---|---|---|
| `pdfkit` | 0.20.2 (2026-08-30) | **Chosen.** Streaming Node output, `registerFont` (path or buffer, subset-embedded), built-in `doc.table({ data })`. context7 `/foliojs/pdfkit` (docs/table.md, getting_started.md). Types: `@types/pdfkit`. |
| `pdf-lib` | 1.17.1 (**2021-11-06**) | Not chosen: unmaintained for 5 years; its strength is editing existing PDFs. |
| `@react-pdf/renderer` | 4.9.0 (2026-08-27) | Not chosen: heavier (React and layout engine in the worker) for a fixed-layout ticket. |

## Jobs

| Package | Latest (date) | Verdict |
|---|---|---|
| `pg-boss` | 12.38.1 (2026-11-05) | **Chosen.** Postgres 13+, Node ≥22.12. Polling by default, with `useListenNotify` off by default. Its docs say LISTEN/NOTIFY doesn't work through PgBouncer in transaction mode and that it falls back to polling. context7 `/timgit/pg-boss`. |
| `graphile-worker` | 0.18.0 (2026-09-08) | Not chosen: LISTEN/NOTIFY is always on, and its FAQ says pgbouncer non-session mode "might pose an issue". It would need Neon's direct URL. context7 `/graphile/worker`. |
| `bullmq` | 6.7.2 (2026-11-07) | Not chosen: it requires Redis. |

## Storefront and testing

| Package | Latest (date) | Use |
|---|---|---|
| `preact` | 11.2.0 (2026-11-06) | Configurator UI bundle, built with Vite into the theme extension `assets/` folder as a flat file |
| `vitest` | 5.1.0 (2026-11-02) | Unit tests (the Shopify function template pins `^3.2.4`) |
| `@playwright/test` | 1.65.0 (2026-11-05) | Storefront e2e against a dev store |
