# Spec 33 — End-to-end suite

**Status:** Not started
**Depends on:** Spec 18, Spec 19, Spec 20, Spec 21, Spec 22, Spec 25, Spec 26, Spec 27, Spec 29, Spec 31, Spec 32
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `playwright.config.ts`, `e2e/`, `specs/inventory/33-e2e-suite.md`
**Reuses:** `ARCHITECTURE.md#test-data`, `test/db.ts` (spec 02), `AGENT-GUIDE.md`

## Goal

The only spec that writes or runs end-to-end tests. Install Playwright, write one test file per flow area
covering every row of the flow table, and get the suite green against the running app and a Shopify dev
store — so the integrated paths are proven once, after every implementation spec has merged.

## Scope

- Install Playwright (chromium only), `playwright.config.ts` with trace + screenshot on failure; add the
  `test:e2e` script named in `AGENT-GUIDE.md`.
- Two projects (spec 00 Testing):
  - **storefront** — a password-protected dev store with the app installed, the app block on the product
    template and the app tunnel/URL running; `E2E_STORE_URL`, `E2E_STORE_PASSWORD` from env.
  - **server** — admin loaders/actions and webhooks called in-process with `testConfig()` and signed
    fixtures (no automated Shopify Admin login), on the test DB.
- Seed through the services (14, 15, 17), never SQL. Each test seeds its own shop data and runs alone.
- Role- and text-based locators inside the Shadow DOM (Playwright pierces open shadow roots); web-first
  assertions; no sleeps.

### Flow table — the coverage contract

| Flow | Built by | Proves |
| --- | --- | --- |
| Shop with no plan opens the admin | 09 | redirect to plan selection |
| Create group + lens with limits, save | 18, 17 | lens listed, sync badge Synced, variant id stored |
| Create option group with a priced value and an add-on | 19, 17 | priced value gets a variant; zero-price does not |
| Save settings with two lab emails, invalid email rejected | 20 | values persist after reload; error shown |
| Admin home checklist ticks after the above | 31 | both items ticked |
| Storefront: product page → Select lenses → SV → manual Rx → lens → options → add-ons → review → Add to cart | 26, 27, 28, 29, 21, 22 | cart has the frame with nested lens/option/add-on lines; total equals review total |
| Storefront: Rx beyond a lens's SPH limit | 27 | that lens is disabled with its reason |
| Storefront: upload path with a PNG | 26, 22 | rxRef stored; review says "Prescription on file" |
| Storefront: cart properties with `storeRxInOrder` off | 29 | no Rx value in the cart JSON (`/cart.js`) |
| Proxy call with a bad signature | 21, 22 | 401 |
| orders/create webhook for a fixture order | 23, 30 | LabOrder SENT with the fake mailer; ticket key in the store |
| Lab orders list → Resend | 32 | job enqueued; status back to Pending |
| Compliance `shop/redact` | 25 | shop rows and S3 prefix gone |

## Explicit non-scope

- Fixing application code → each app bug becomes a new fix spec numbered after spec 34, appended to
  `README.md` and `PROGRESS.md`; this spec's Log names it and the test stays `fixme` with that number.
- Unit tests — each spec owns its own. Clean-install verification → spec 34.

## Reuse first

- Fixtures and fakes recorded in `specs/inventory/` (signed webhook/proxy request builders from 01/21,
  the in-memory mailer and object store from 06/07). Do not build a second seeding path.

## Steps

1. Install Playwright + chromium; configure both projects.
2. One trivial test per project (server: health loader; storefront: product page loads); get them green.
3. One file per flow area under `e2e/`, every flow-table row covered.
4. Run headless; triage each failure as test bug (fix) or app bug (fix spec + `fixme`).
5. Record fix specs in the Log; counts from the runner's own summary line.

## Done when

- [ ] `pnpm test:e2e --project=server` passes headless with 0 failures (excluding `fixme` tests naming a fix spec). [e2e]
- [ ] `pnpm test:e2e --project=storefront` passes headless with 0 failures. [requires: Shopify dev store with app installed and block placed, E2E_STORE_URL/PASSWORD, running app URL]
- [ ] Every row of the flow table has at least one test, named in the Log. [static]
- [ ] Every app bug found has a numbered fix spec in `README.md` and `PROGRESS.md`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
