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
| R8 | 2026-11-07 | 06 | R1-F1 | Accepted | Presigned uploads must work from a browser with a non-empty body: disable default request checksums for presigning (requestChecksumCalculation WHEN_REQUIRED) or sign UNSIGNED-PAYLOAD; a test asserts the signed URL carries no empty-body CRC32. |
| R9 | 2026-11-07 | 06 | R1-F2 | Accepted | Spec 06 contract: upload is application/pdf, max 10 MB. Sign Content-Type and Content-Length into the presigned PUT so S3 rejects mismatches; the TooLargeError check alone is not enforcement. |
| R10 | 2026-11-07 | 06 | R1-F3 | Accepted | presignDownload expiry is fixed at 60 s by the spec; callers cannot pass it. |
| R11 | 2026-11-07 | 06 | R1-F4 | Accepted | INV-10: deletePrefix accepts only the canonical shops/<id>/ form (and sub-prefixes built by the key builders); reject .., //, leading /, encoded separators, whitespace and empty id. Add the hostile cases as test rows. |
| R12 | 2026-11-07 | 06 | R1-F5 | Accepted | No silent no-op or unsigned fallback in production: a missing S3 config fails through config.server.ts with the key name. |
| R13 | 2026-11-07 | 06 | R1-F6 | Accepted | buildTicketKey accepts only pdf or csv (spec 06 key layout). |
| R14 | 2026-11-07 | 03 | R1-F1 | Accepted | Bundle line-item properties must round-trip any valid id: use JSON (or another unambiguous encoding) for id lists, and add hostile ids (comma, quote, non-ASCII, empty-looking) to the round-trip property test. |
| R15 | 2026-11-07 | 03 | R1-F2 | Out | INV-5 requires integer hundredths/tenths/degrees at runtime, which the zod schemas enforce. Branded nominal types are not in spec 03 or INV-5; plain number aliases are acceptable. Raise branding as a follow-up if a later spec needs it. |
| R16 | 2026-11-07 | 03 | R1-F3 | Accepted | INV-4: currency must be a real ISO-4217 code. Validate against a code list (e.g. Intl.supportedValuesOf('currency')) and test an unknown uppercase code such as LOL. |
| R17 | 2026-11-07 | 03 | R1-F4 | Accepted | Spec 03 step 3 is read(build(x)) == x. Define the normalized input (what read returns for fields that do not apply, e.g. storeRxInOrder on non-lens) in the spec Examples, normalize x the same way, and compare directly over 200 generated bundles. |
| R18 | 2026-11-07 | 03 | R1-F5 | Accepted | Float rejection is proven per field: a table-driven test covers every money and diopter field in every exported schema (priceDelta, AddOn.price, sph/cyl/add, ADD limits). |
| R19 | 2026-11-07 | 03 | R1-F6 | Accepted | The inventory lists every public root export of rx-core, or the unintended exports are removed. |
| R20 | 2026-11-07 | 03 | R1-F7 | Accepted | Kind logic,parser: add the applicable Examples rows (empty input, single item, hostile and non-ASCII ids, very long values; tie is n/a) to the spec Examples table, each with a test case. |
| R21 | 2026-11-07 | 03 | R1-F8 | Accepted | git diff --check must be clean. |
| R24 | 2026-11-07 | 06 | R2-F2 | Accepted | INV-10 proof: the ListObjectsV2 fake must be driven by the Prefix and ContinuationToken inputs and the test must assert both on every call, so dropping either fails it. |
| R25 | 2026-11-07 | 06 | R2-F1 | Accepted | Per R1-F4 ruling: deletePrefix accepts exactly shops/<id>/ and the sub-prefixes the key builders produce (e.g. shops/<id>/tickets/); any other sub-prefix is rejected. Test both an allowed builder sub-prefix and an arbitrary one. |
| R26 | 2026-11-07 | 06 | R2-F3 | Out | Not a spec change: orchestro/team.json on this branch is byte-identical to main after PR #4 (owner decision). The three-dot diff shows it because the branch base predates #4; merging is a no-op for that file. team.json is lead-owned and outside review scope. |
| R27 | 2026-11-07 | 09 | R1-F1 | Accepted | Shopify App Pricing: plan status is Partner API activeSubscription(appId, shopId) (shopify.dev shopify-app-pricing; stack.md). Admin currentAppInstallation.activeSubscriptions is only the fallback when activeSubscription is null; unpaid only when both are empty. Partner credentials are lazy config keys (PARTNER_ORGANIZATION_ID, PARTNER_API_ACCESS_TOKEN, SHOPIFY_APP_GID); spec 09 text is updated to match. |
| R28 | 2026-11-07 | 09 | R1-F2 | Out | orchestro/team.json on spec branches is identical to main after PR #4 (owner decision); the three-dot diff shows it only because the branch base predates #4. Lead-owned config is outside review scope; see spec 06 R2-F3. |
| R29 | 2026-11-07 | 09 | R1-F3 | Accepted | Spec 09: result cached per request only. Memoize within one request (e.g. WeakMap keyed by Request), re-query on the next request, and test both boundaries; replace the test that asserts no caching. |
| R30 | 2026-11-07 | 02 | R1-F1 | Out | INV-1 places tenancy in repository functions (every query filters by shop, two-shop tests per repository spec). Composite (shopId, id) foreign keys are defence in depth, not required by spec 02 or INV-1; plain id relations stand. |
| R31 | 2026-11-07 | 02 | R1-F2 | Accepted | The upgrade test must start from a real template database (Session table, no _prisma_migrations) and go through the supported Prisma baseline path (migrate resolve --applied for the baseline, then migrate deploy), never by writing Prisma's internal table by hand. Document the production upgrade step in the spec Log. |
| R32 | 2026-11-07 | 02 | R1-F3 | Accepted | Spec 02: Money is Int minor units plus currency String(3) (INV-4). Every money column, OptionValue.priceDeltaMinor included, gets its currency; a DMMF-driven test asserts each *Minor field has a sibling currency field. |
| R33 | 2026-11-07 | 02 | R1-F4 | Accepted | Wrap the init migration in BEGIN/COMMIT so a failure leaves no partial schema. An injected-failure test is not required. |
| R34 | 2026-11-07 | 02 | R1-F5 | Accepted | INV-2 test must be non-vacuous: assert Prescription's exact allowed column set (cipher, metadata, ids, timestamps), so any added plaintext Rx field fails it. |
| R35 | 2026-11-07 | 02 | R1-F6 | Accepted | git diff --check must be clean. |
| R36 | 2026-11-07 | 02 | R1-F7 | Out | The spec Status line is lead-owned; Orchestro sets it at merge. Coders do not edit it. |
| R37 | 2026-11-07 | 03 | R2-F1 | Accepted | Every Examples row is a test case with that row's exact inputs: the storeRxInOrder-off example uses SPH -2.25 and scans the properties for '2.25' (and '-2.25'). |
| R38 | 2026-11-07 | 03 | R2-F2 | Out | Lead-owned bookkeeping: spec 06 Status and PROGRESS.md lines are synced by orchestro spec commit to match main after spec 06 merged; they are identical to main and outside review scope (see spec 06 R2-F3). |
| R39 | 2026-11-07 | 02 | R2-F1 | Accepted | Every migration is wrapped in BEGIN/COMMIT, the baseline included (consistent with R1-F4). |
| R40 | 2026-11-07 | 02 | R2-F2 | Out | Lead-owned bookkeeping (spec 06 Status, PROGRESS.md) synced by orchestro spec commit to match main after spec 06 merged; identical to main and outside review scope (see spec 06 R2-F3, spec 03 R2-F2). |
| R41 | 2026-11-07 | 09 | R2-F1 | Out | Lead-owned bookkeeping (spec 06 Status, PROGRESS.md) synced by orchestro spec commit to match main after spec 06 merged; identical to main and outside review scope (see spec 06 R2-F3). |
| R42 | 2026-11-07 | 08 | R1-F1 | Accepted | Spec 08/INV-2: payloads carry only ids and enums. Number and bigint fields follow the same rule as strings (name *Id/*Key or whitelisted in the inventory) because Rx values are integers (-225). Booleans are allowed (flags carry no Rx). Test: a schema with sph: number throws at registration. |
| R43 | 2026-11-07 | 08 | R1-F2 | Accepted | defineJob rejects schemas containing ZodEffects (transform, preprocess, refine-with-transform) anywhere in the tree, so what is validated is what is persisted. Test the transform case from the review. |
| R44 | 2026-11-07 | 08 | R1-F3 | Accepted | No production API persists an unvalidated payload: remove Queue.enqueueRaw; tests that need a legacy or malformed payload insert it through test-only support. |
| R45 | 2026-11-07 | 08 | R1-F4 | Accepted | defineJob rejects ZodIntersection (and any schema shape the receive-side strict check cannot walk) at registration; add a test. |
| R46 | 2026-11-07 | 08 | R1-F5 | Out | Lead-owned files (orchestro/team.json, other specs' Status lines, PROGRESS.md) are synced by orchestro spec commit to match main; identical to main and outside review scope (see spec 06 R2-F3). |
| R47 | 2026-11-07 | 08 | R1-F6 | Out | Lead-owned files (orchestro/team.json, other specs' Status lines, PROGRESS.md) are synced by orchestro spec commit to match main; identical to main and outside review scope (see spec 06 R2-F3). |
| R48 | 2026-11-07 | 08 | R1-F7 | Out | Lead-owned files (orchestro/team.json, other specs' Status lines, PROGRESS.md) are synced by orchestro spec commit to match main; identical to main and outside review scope (see spec 06 R2-F3). |
| R49 | 2026-11-07 | 08 | R1-F8 | Out | Lead-owned files (orchestro/team.json, other specs' Status lines, PROGRESS.md) are synced by orchestro spec commit to match main; identical to main and outside review scope (see spec 06 R2-F3). |
| R50 | 2026-11-07 | 10 | R1-F1 | Accepted | Plano/zero parsing returns 0, but range checks are per field after parsing: ADD 0 (PL, plano, 0) is out of range +0.75..+3.50 where ADD is required. Test ADD PL and ADD 0 for PROGRESSIVE and READING. |
| R51 | 2026-11-07 | 10 | R1-F2 | Accepted | NON_PRESCRIPTION requires an empty prescription: any present value (primitive, notes, unknown key) is an error. Add hostile-shape tests. |
| R52 | 2026-11-07 | 10 | R1-F3 | Accepted | NON_PRESCRIPTION with undefined, null or {} is valid and normalizes to an explicit absent-prescription result, never a cast Prescription with invented zeros or PD 630. |
| R53 | 2026-11-07 | 10 | R1-F4 | Accepted | PD is exactly one representation: single XOR (od and os). Both or neither is an error; test the conflicting shapes. |
| R54 | 2026-11-07 | 10 | R1-F5 | Out | Lead-owned bookkeeping (other specs' Status, PROGRESS.md) synced by orchestro spec commit to match main; outside review scope (see spec 06 R2-F3). |
| R55 | 2026-11-07 | 08 | R2-F1 | Accepted | Narrows ruling R1-F1: payload schemas may not contain bigint at all (JSON-unsafe); defineJob rejects it at registration. Numbers named *Id/*Key stay allowed. |
| R56 | 2026-11-07 | 08 | R2-F2 | Accepted | Plain z.union is rejected at registration; use z.discriminatedUnion, and strict-key validation runs against the branch the discriminator selects. Test the orderId/accountId case. |
| R57 | 2026-11-07 | 08 | R2-F3 | Accepted | INV-8 proof: enqueue two different valid payloads with the same explicit singletonKey and assert one job; and two identical payloads with different keys and assert two. |
| R58 | 2026-11-07 | 08 | R2-F4 | Accepted | Retry proof: configure a retryLimit distinct from pg-boss's default (e.g. 4) and assert the exact attempt count, so dropping the option fails the test. |
| R59 | 2026-11-07 | 08 | R2-F5 | Accepted | ARCHITECTURE structural rule: PgBoss is constructed only in app/shared/container/ and injected into the queue adapter. |
| R60 | 2026-11-07 | 08 | R2-F6 | Accepted | Re-registering an existing queue reconciles its retry/policy/dead-letter settings (create, then update); test a queue whose retry policy changes between registrations. |
| R61 | 2026-11-07 | 08 | R3-F2 | Accepted | z.literal is allowed only for string, number (finite), boolean or null values; bigint/symbol/undefined literals throw at registration. Add a test. |
| R62 | 2026-11-07 | 08 | R3-F3 | Accepted | The payload root must be a z.object or z.discriminatedUnion of objects, with no optional/nullable/default wrapper at the root; defineJob throws otherwise. Add a test. |
| R63 | 2026-11-07 | 08 | R3-F1 | Accepted | Forbid z.catch anywhere in a payload schema (fallback values are unvalidated output); defineJob throws at registration. Add a test. |
| R64 | 2026-11-07 | 04 | R1-F1 | Accepted | Build must run on every Node in engines (>=22.12) with no type stripping: do not import .ts from .mjs. Move the shared build config to a .js/.mjs module (or load it via vite's loadConfigFromFile); keep engines as is. |
| R65 | 2026-11-07 | 04 | R1-F2 | Accepted | Remove the schema default from button_label so a blank setting falls back to the storefront-locale string (select_lenses.button_label \| t); keep the label translation key. |
| R66 | 2026-11-07 | 04 | R1-F3 | Out | Lead-owned bookkeeping: other specs' PROGRESS.md/Status lines are synced by orchestro spec commit to match main; outside review scope (see spec 06 R2-F3). |
| R67 | 2026-11-07 | 11 | R1-F1 | Accepted | Narrow fix: add test cases for a single-lens list (one available, one not), the inclusive max boundary (OD +600 available, +625 SPH_ABOVE_MAX) and an Rx failing both min and max checks on different eyes. Add a Log line: no rounding applies (integer hundredths in and out, INV-5) and limits are inclusive at both ends. Do not change the Examples table or engine behaviour. |

