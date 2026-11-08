# Inventory fragment — Spec 32 (Admin: lab orders list, resend and ticket download)

### `lab-orders-admin-service`
`app/features/lab-orders-admin/lab-orders-admin.service.server.ts` — Read and dispatch services for merchant lab order management:
- `listLabOrdersService(shopId, options, deps)`: Reads newest-first lab orders scoped to `shopId` with cursor pagination (default 50 per page) and optional status filtering (INV-1).
- `getLabOrderDetailService(shopId, labOrderId, deps)`: Reads order detail scoped to `shopId`, joining lens, prescription metadata (never plaintext/cipher Rx, INV-2), option values with option group kind/name, and add-ons. Returns null if not found or belongs to another shop.
- `resendLabOrderService(shopId, labOrderId, deps)`: Resets order status to `PENDING`, clears `lastErrorCode`, and re-enqueues `lab-orders.dispatch` by delegating to Spec 30's `resend` (INV-1).
- `getTicketDownloadUrlService(shopId, labOrderId, ticketKey, deps)`: Validates that `ticketKey` starts with `shops/<shopId>/tickets/<labOrderId>.`, ends with an allowed extension (`.pdf` or `.csv`), and belongs to `order.ticketKeys` (INV-1, R1-F4). Generates a presigned 60-second S3 download URL using `getObjectStore().presignDownload` (Spec 06, Self-check 1).
- `formatPrescriptionSummary(prescription)`: Formats prescription metadata into privacy-safe copy ("Prescription: on file (typed)", "Prescription: on file (uploaded, N file(s))", "None", or "Non-prescription") without leaking clinical diopters or notes (INV-2).
**Use instead of:** Ad-hoc order queries or generating download URLs inside loaders.
**Added by:** spec 32.

### `lab-orders-admin-repository`
`app/features/lab-orders-admin/lab-orders-admin.repository.server.ts` — Database access scoped strictly by `shopId` (INV-1):
- `listLabOrders(shopId, options, db)`: Queries `LabOrder` with `where: { shopId, ...status }`, `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`, and cursor pagination with shop validation (INV-1, R1-F7).
- `getLabOrderDetail(shopId, labOrderId, db)`: Fetches `LabOrder` with `where: { id: labOrderId, shopId }`, selecting safe prescription fields (`id`, `rxType`, `source`, `uploadKeys`, `createdAt`), lens, option values, and add-ons.
**Use instead of:** Unscoped Prisma queries across merchants.
**Added by:** spec 32.

### `lab-orders-error-codes`
`app/features/lab-orders-admin/errors.ts` — `LAB_ORDER_ERROR_MESSAGES`, `formatLabOrderError`, `UNKNOWN_ERROR_MESSAGE`:
- Mapping table from machine error codes (`NO_LAB_EMAIL`, `MAIL_FAILED`, `STORAGE_FAILED`, `RX_DECRYPT_FAILED`, `LOAD_FAILED`, `TICKET_RENDER_FAILED`, `NO_LENS_IN_BUNDLE`, `LENS_NOT_FOUND`, `OPTION_NOT_FOUND`, `RX_NOT_FOUND`) to plain English sentences (R1-F5).
- Unknown error codes return `UNKNOWN_ERROR_MESSAGE` ("Something went wrong") (Self-check 2).
**Use instead of:** Displaying raw error constants or arbitrary exception strings to merchants.
**Added by:** spec 32.

### `lab-orders-status-badge`
`app/features/lab-orders-admin/status-badge.tsx` — `renderStatusBadge`, `LabOrderStatusBadge`:
- Shared badge component for status display across list and detail routes; maps FAILED status to plain English sentence via error table or "Something went wrong" when code is null/empty (R1-F5).
**Use instead of:** Duplicating status badge rendering between routes.
**Added by:** spec 32.

### `lab-orders-admin-nav`
`app/features/lab-orders-admin/nav.ts` — Navigation item for admin sidebar (`{ label: "Lab orders", href: "/app/lab-orders", order: 5 }`).
**Use instead of:** Hardcoding lab orders navigation links.
**Added by:** spec 32.

### `lab-orders-admin-routes`
- `app/routes/app.lab-orders._index.tsx`: List route with status filtering, cursor pagination, shopify order link, frame, lens, status badge with error code translation and settings link, out-of-limits badge, and empty state.
- `app/routes/app.lab-orders.$id.tsx`: Detail route with order metadata, prescription summary (INV-2), per-click ticket download action (Self-check 1), and "Resend to lab" `<s-modal>` confirmation (Spec 30 reuse).
**Use instead of:** Creating duplicate admin order screens.
**Added by:** spec 32.
