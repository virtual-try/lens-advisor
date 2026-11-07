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

