# Inventory fragment — Spec 01 (Scaffold, workspace and unit harness)

### `config-getters`
`app/shared/config.server.ts` — Lazy, zod-validated environment configuration reader exposing typed config sections (`database`, `shopify`, `rx`, `s3`, `resend`, `appProxy`) and standalone getters.
**Use instead of:** Reading `process.env` anywhere in `app/` or `packages/`.
**Added by:** spec 01.

### `app-error`
`app/shared/http/errors.server.ts` — Base HTTP application error class (`AppError`) carrying HTTP status, upper-snake error code, safe message, and optional field error details.
**Use instead of:** Throwing bare `Response` objects or generic `Error` instances without standard codes.
**Added by:** spec 01.

### `error-responder`
`app/shared/http/errors.server.ts` — JSON error responder (`errorResponse` / `jsonError`) formatting errors into the standardized `{ "error": { "code": "...", "message": "..." } }` envelope.
**Use instead of:** Manually constructing ad-hoc JSON error responses in routes.
**Added by:** spec 01.

### `prisma-container`
`app/shared/container/prisma.server.ts` — Composition root lazy singleton getter `getPrisma()` for the PrismaClient instance.
**Use instead of:** Instantiating `new PrismaClient()` in feature code or routes.
**Added by:** spec 01.

### `nav-glob-contract`
`app/shared/nav/index.ts` — Admin navigation discovery contract that eagerly globs `app/features/*/nav.ts` modules exporting `{ nav: { label, href, order } }` or default export, sorted ascending by `order`.
**Use instead of:** Hardcoding navigation items or adding links directly to `app/routes/app.tsx`.
**Added by:** spec 01.

### `worker-glob-contract`
`app/worker.server.ts` — Background worker job discovery contract that globs `app/features/*/jobs.server.ts` modules and registers each exported job definition with the pg-boss queue.
**Use instead of:** Manually wiring job handler imports in a central worker file.
**Added by:** spec 01.
