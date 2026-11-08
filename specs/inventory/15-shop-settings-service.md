# Inventory fragment — Spec 15 (Shop settings repository and service)

### `shop-settings`
`app/features/settings/settings.service.server.ts` — `getSettings(shopId, db?)` returns the shop's settings, or defaults when no row exists (`labEmail: []`, `ticketFormat: "PDF"`, `storeRxInOrder: false`, both prescription inputs on) and does not insert. `updateSettings(shopId, patch, db?)` validates the patch, merges it, and upserts one row for that shop. `isSetupComplete(shopId, db?)` returns `{ labEmail: boolean }` (true when at least one address is saved) and does not insert. `isComplete` is the same function. The public address field is `labEmail` (string or string array on input, string array on output), stored in the Prisma column `labEmails`. Omit `db` in the app; it defaults to the container client. Pass the `createTestDb()` client in tests.
**Use instead of:** reading or writing `ShopSettings` from a route, or a second settings model.
**Added by:** spec 15.

### `shop-settings-repository`
`app/features/settings/settings.repository.server.ts` — `findShopSettings(db, shopId)`, `lockShop(db, shopId)`, `upsertShopSettings(db, shopId, settings)`. Each call filters by `shopId`. `lockShop` is a `SELECT … FOR UPDATE` on that shop row. `upsertShopSettings` writes only the row passed in; a throw inside the same transaction rolls the write back.
**Use instead of:** a Prisma call in a route or a settings query without `shopId`.
**Added by:** spec 15.

### `shop-settings-schema`
`app/features/settings/schema.ts` — `parseSettingsPatch`, `defaultShopSettings`, `ValidationError` (400, codes `EMAIL`, `AT_LEAST_ONE_RX_INPUT`, `INVALID`), and the `ShopSettings` / `SetupComplete` types. `EMAIL` is an address zod rejects (`lab@x`, blank). `AT_LEAST_ONE_RX_INPUT` means both `rxUploadEnabled` and `manualRxEnabled` would be off. A stored row that fails those rules is not returned; `getSettings` throws `InternalServerError` `CORRUPT_SETTINGS`.
**Use instead of:** re-validating lab emails or the prescription-input rule in the settings route.
**Added by:** spec 15.
