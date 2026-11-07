# Inventory fragment — Spec 02 (Database schema and first migration)

### `test-db`
`test/db.ts` — `createTestDb()` creates schema `t_<random>` on `TEST_DATABASE_URL`, runs `prisma migrate deploy`, and returns a Prisma client plus `drop()`.
**Use instead of:** Sharing one database across tests, or running migrations against the app database from a test.
**Added by:** spec 02.

### `seed-shop`
`test/db.ts` — `seedShop(db, domain)` inserts one shop and one fixture row in every shop-owned table.
**Use instead of:** Hand-rolling a shop fixture per feature test.
**Added by:** spec 02.

### `prisma-models`
`prisma/schema.prisma` — MVP models `Shop`, `ShopSettings`, `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`, `Prescription`, `LabOrder`, `ComplianceRequest`. Template `Session` stays as it was.
**Use instead of:** A second schema or ad-hoc tables for catalog, prescriptions, lab orders, or compliance.
**Added by:** spec 02.
