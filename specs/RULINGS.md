# Review rulings

Read this **before** reviewing any spec. It does two things: it calibrates
severity, and it records points the lead has already ruled on, so they are not
raised again.

## Severity

| Severity | Means | Examples |
| --- | --- | --- |
| **BLOCKER** | Must not merge. Wrong behaviour, data loss, a security or privacy hole, a broken invariant (`INVARIANTS.md`), or a ticked `Done when` box with no proof | A private item in a search result · a test that passes with the code deleted · a user edit overwritten |
| **MAJOR** | Fix before merge, but the behaviour is not wrong today | A missing error state · a stub in production code that is not reachable yet · an `Examples` row with no test |
| **MINOR** | Worth fixing, never blocks | Naming · comment wording · a helper that could be shared · test layout |

A finding that is only a preference is MINOR. A finding without a path and a
line is not a finding. When unsure between two levels, pick the lower one and
say why.

## Rulings

Append-only. One row per ruling. A reviewer does not raise a ruled-out point
again unless the code it rested on has changed — then say what changed.

| # | Date | Spec | Finding | Ruling | Reason |
| --- | --- | --- | --- | --- | --- |
| R1 | 2026-11-07 | 01 | R1-F1 | Accepted | Dockerfile is not in spec 01's Owns list and deploy is Render's native node runtime (render.yaml). Remove Dockerfile and .dockerignore rather than porting them to pnpm. |
| R2 | 2026-11-07 | 01 | R1-F2 | Accepted | config.server.ts must zod-validate every key in .env.example; SHOPIFY_APP_URL is required and must be a URL; a missing required key fails at first config read with the key name, never defaults to an empty string. |
| R3 | 2026-11-07 | 01 | R1-F3 | Accepted | No lint rule may be disabled or weakened to make template code pass (INVARIANTS: no weakened gates). Re-enable @typescript-eslint/no-explicit-any and type the template code properly. |
| R4 | 2026-11-07 | 01 | R1-F4 | Out | The process.env rule (ARCHITECTURE: config.server.ts is the only reader) covers runtime code under app/ and packages/. Repo-root build tooling (vite.config.ts, the Shopify template's HMR/host shim) runs before app config exists and is exempt. The grep check is: grep -rn process.env app packages finds only app/shared/config.server.ts. |
| R5 | 2026-11-07 | 01 | R1-F5 | Out | render.yaml 'env var keys only, no values' means no secrets or deployment-specific values. Fixed public constants (NODE_ENV: production) are allowed; every real setting stays a key with sync: false, as it is. |
| R6 | 2026-11-07 | 01 | R1-F6 | Accepted | Trailing whitespace: git diff --check must be clean. |
| R7 | 2026-11-07 | 01 | R2-F1 | Accepted | Owner-gated Done-when boxes ([requires: ... owner provides]) stay unticked and do not block merge, but the spec Log must say so in one line naming who runs the check. For 01, the owner runs shopify app dev on a dev store (decision queued). |

