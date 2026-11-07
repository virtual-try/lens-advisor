# Invariants — violating one is a defect

Rules that hold across **several** specs. Each has a stable ID: never renumber,
never reuse a retired number — mark it `Retired` instead. A spec lists the IDs
it touches in its `**Invariants:**` header line, and its `Done when` has one
box per listed ID saying how *this* spec proves it.

### INV-1 — Every read and write is scoped to one shop

- **Rule:** Every repository function takes the shop domain (or shop id) as an argument and filters by it. No query reads or writes a row belonging to another shop. Storefront (app proxy) requests take the shop only from the verified proxy signature, never from the request body or query string.
- **Why:** One app serves many merchants; a missing `where shopId` leaks one store's catalog, prescriptions or orders to another.
- **Check:** For every repository function a spec adds, a unit test seeds rows for two shops and asserts the other shop's rows are absent from the result and untouched by the write.
- **Touches:** specs 02, 14, 15, 17, 18, 19, 20, 21, 22, 23, 25, 30, 31, 32.

### INV-2 — Prescription data is encrypted at rest and never logged

- **Rule:** Prescription values (SPH, CYL, AXIS, ADD, PD, prism, notes) and uploaded prescription files are stored only as ciphertext — DB fields through `app/shared/crypto/field-cipher.server.ts` (spec 05), files in S3 with server-side encryption under the `rx/` prefix (spec 06). Plaintext Rx never appears in logs, error messages, queue job payloads (jobs carry IDs only), analytics events or URLs.
- **Why:** Prescriptions are health data; the blueprint promises encrypted storage, and a leak through a log line is still a leak.
- **Check:** A unit test reads the raw stored column and asserts it does not contain the plaintext value; `rg` for logger calls in the spec's files that pass an Rx object finds none; job payload schemas contain only IDs.
- **Touches:** specs 02, 05, 06, 07, 08, 22, 23, 24, 25, 26, 30, 32.

### INV-3 — Plaintext Rx stays out of Shopify when the shop says so

- **Rule:** **If** the shop setting `storeRxInOrder` is off (the default), the cart line properties the configurator writes **shall** contain only the opaque `_rx_ref` and the human summary "Prescription on file" — never Rx values. **If** it is on, values are written under underscore-prefixed keys only.
- **Why:** Shopify order properties are visible to every staff account and every app with order access; this is the blueprint's privacy toggle.
- **Check:** A unit test builds cart properties with the setting off and asserts no Rx value (as text) appears in any property; with it on, every Rx key starts with `_`.
- **Touches:** specs 03, 15, 20, 21, 29.

### INV-4 — Money is integer minor units with a currency code

- **Rule:** Every price is an integer number of minor units (cents) plus an ISO 4217 currency code. No float arithmetic on money anywhere; formatting to a display string happens only in UI code via `Intl.NumberFormat`.
- **Why:** 0.1 + 0.2 bugs in totals, and lens upcharges summed in floats drift by a cent.
- **Check:** `rg` for `parseFloat`/`toFixed` on price fields in the spec's files finds none; pricing tests assert exact integers.
- **Touches:** specs 02, 03, 13, 14, 17, 19, 28, 29.

### INV-5 — Diopter values are integer hundredths internally

- **Rule:** SPH, CYL and ADD are held as signed integers in hundredths of a diopter (−2.25 D → `-225`), AXIS as an integer 1–180, PD as integer tenths of a millimetre. Conversion from shopper text happens once, in the Rx parser (spec 10); display formatting happens once, in rx-core's formatter.
- **Why:** Range checks like "SPH between −8.00 and +6.00" on floats fail at the boundary.
- **Check:** rx-core types make the integer unit explicit in the field name or type; Examples tables include the exact boundary value.
- **Touches:** specs 02, 03, 10, 11, 14, 18, 24, 27.

### INV-6 — Nothing from outside is trusted until verified

- **Rule:** App proxy requests are verified with the template's app-proxy authenticator before anything else runs; webhooks are verified with the webhook authenticator; every request body and every webhook payload field the code uses is parsed through a zod schema from `packages/rx-core` or the feature's own `schema.ts`. A failed check returns 401/400 with the error shape in `ARCHITECTURE.md#errors` and does no work.
- **Why:** The storefront is public; a forged proxy call could write prescriptions into another shop.
- **Check:** For each endpoint a spec adds, a test sends an unsigned/forged request and asserts 401 and that no repository function was called; a test sends an invalid body and asserts 400.
- **Touches:** specs 21, 22, 23, 25.

### INV-7 — No raw design values outside the token file

- **Rule:** Storefront configurator CSS uses only the custom properties defined in `packages/configurator/src/styles/tokens.css` (transcribed from `DESIGN-SYSTEM.md`). No raw hex, rgb, px font size, radius or duration elsewhere in `packages/configurator/`. The merchant admin uses Polaris web components only — no custom colours or CSS in `app/routes/app.*`.
- **Why:** The configurator must re-skin cleanly inside unknown merchant themes via a handful of overridable properties.
- **Check:** `rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms' <owned paths> --glob '!tokens.css'` finds nothing.
- **Touches:** specs 04, 16, 18, 19, 20, 26, 27, 28, 29, 31, 32.

### INV-8 — Webhooks answer fast; background work goes through the queue; jobs are idempotent

- **Rule:** A webhook handler verifies, persists the minimum, enqueues a job by ID and returns 200 — no PDF rendering, email sending or S3 upload inside the request. Every job handler can run twice for the same input with the same end state (keyed by Shopify order id or webhook id).
- **Why:** Shopify retries slow webhooks and the queue retries failed jobs; double-sending a lab ticket means a lab grinds lenses twice.
- **Check:** A unit test delivers the same webhook / runs the same job twice and asserts one row, one email.
- **Touches:** specs 08, 23, 25, 30.

### INV-9 — Every user-visible storefront string comes from a strings file

- **Rule:** Configurator text lives in the step's `strings.ts` (or `packages/configurator/src/shared/strings.ts` for shared ones), never inline in JSX.
- **Why:** Translation (and the deferred Arabic/RTL work) must not mean touching every component.
- **Check:** `rg` for JSX text literals in the spec's `.tsx` files finds none outside strings files.
- **Touches:** specs 04, 16, 26, 27, 28, 29.

### INV-10 — Uninstall and shop redaction leave nothing behind

- **Rule:** **When** `shop/redact` arrives, every row with that shop's id in every table, and every S3 object under `shops/<shopId>/`, **shall** be deleted. Any new table with a shop id is added to the redaction list in the same spec that creates it.
- **Why:** Shopify requires it, and prescriptions are the data most worth deleting.
- **Check:** Spec 25's test enumerates every Prisma model with a shop field (from the Prisma DMMF) and asserts each is covered by the redaction routine.
- **Touches:** specs 02, 06, 25.
