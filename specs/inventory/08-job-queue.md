# Inventory fragment — Spec 08 (Job queue and worker process (pg-boss))

### `queue-container`
`app/shared/container/queue.server.ts` — Client constructor `createPgBoss` and composition root lazy singleton getter `getQueue()` that returns a running `Queue` instance backed by pg-boss in schema `pgboss` (polling mode, Neon pooler safe), with all feature jobs registered alongside their `<name>.dead` dead-letter queues.
**Use instead of:** Instantiating `new PgBoss(...)` outside `app/shared/container/` or creating raw queues in web routes or loaders.
**Added by:** spec 08.

### `define-job`
`app/shared/queue/define-job.ts` — Factory for typed background jobs (`defineJob`). Enforces INV-2: payload schema must be a zod object or discriminated union containing only ids/keys (string or number fields matching `/(?:Id|Ids|Key|Keys)$/`), enums, JSON-safe literals, and booleans. Rejects bigints and non-JSON-safe literals (JSON-unsafe), `ZodCatch`, `ZodEffects`, `ZodIntersection`, root optional/nullable/default wrappers, and plain `ZodUnion` (use `ZodDiscriminatedUnion`) at registration. Any string or number field not ending in `Id`/`Ids`/`Key`/`Keys` causes registration to throw `JobDefinitionError` unless explicitly listed in `allowStringFields`. Validates payloads both on enqueue and on receive, throwing a sanitized `JobPayloadValidationError` (path/code only, no plaintext received values) on failure.
**Use instead of:** Unvalidated `pg-boss` send/work calls or hand-rolled retry/dead-letter loops.
**Added by:** spec 08.

### `jobs-discovery-contract`
`app/shared/queue/discovery.server.ts` & `app/shared/queue/web-definitions.server.ts` — Feature job discovery contract. Features export `JobDefinition` instances from `app/features/<feature>/jobs.server.ts`. Discovered via eager glob on the web side (`registerWebFeatureJobs`) and filesystem directory scan on the worker side (`discoverJobs`).
**Use instead of:** Manually registering feature job handlers in a central worker file.
**Added by:** spec 08.
