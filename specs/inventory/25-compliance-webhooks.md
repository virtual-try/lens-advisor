# Inventory fragment — Spec 25 (Compliance and uninstall webhooks)

### `compliance-webhook-route`
`app/routes/webhooks.compliance.ts` — One action for `customers/data_request`, `customers/redact`, and `shop/redact`. Verifies the webhook, records a `ComplianceRequest`, enqueues the matching job, and returns 200. A forged HMAC is 401. An unknown shop is 200 with no row.
**Use instead of:** A route per compliance topic, or doing redaction, mail, or S3 work inside the request.
**Added by:** spec 25.

### `app-uninstalled-route`
`app/routes/webhooks.app.uninstalled.ts` — Verifies `app/uninstalled`, sets `Shop.uninstalledAt` once, and deletes that shop's sessions. Catalog and prescription rows stay until `shop/redact`.
**Use instead of:** Deleting shop data from the uninstall webhook.
**Added by:** spec 25.

### `compliance-jobs`
`app/features/compliance/jobs.server.ts` — `compliance.customers-redact`, `compliance.customers-data-request`, and `compliance.shop-redact`. Payloads are ids only. Discovered from this file by the worker.
**Use instead of:** Inline webhook work, or a job payload that carries prescription values or a mailbox.
**Added by:** spec 25.

### `shop-owned-delete-order`
`app/features/compliance/models.server.ts` — `shopOwnedModels` and `shopOwnedModelDeleteOrder` list every shop-owned Prisma model from the DMMF (Session excluded; it is keyed by domain) and order deletes so a referencing row goes first.
**Use instead of:** A hand-maintained table list for `shop/redact`.
**Added by:** spec 25.

### `compliance-redact`
`app/features/compliance/redact.server.ts` — `runCustomersRedact` deletes the listed orders' prescriptions and `rx/<id>/` objects and nulls `LabOrder.prescriptionId`. `runShopRedact` deletes every shop-owned row in one transaction, then `deletePrefix("shops/<shopId>/")`.
**Use instead of:** Direct S3 calls, or a delete that is not scoped by `shopId`.
**Added by:** spec 25.

### `compliance-data-request`
`app/features/compliance/data-request.server.ts` — `runCustomersDataRequest` decrypts that shop's prescriptions for the listed orders and emails one JSON attachment to the shop contact. The log line is ids only.
**Use instead of:** Emailing the customer directly, or logging the decrypted prescription.
**Added by:** spec 25.
