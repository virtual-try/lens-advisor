# Inventory fragment — Spec 03 (rx-core domain types and schemas)

### `diopter-type`
`packages/rx-core/src/types/index.ts` — `Diopter`: signed integer hundredths of a diopter (−2.25 D → `-225`).
**Use instead of:** a float or a `number` named `sph`/`cyl`/`add` without a unit.
**Added by:** spec 03.

### `axis-type`
`packages/rx-core/src/types/index.ts` — `Axis`: integer degrees 1–180.
**Use instead of:** a string or a 0–360 angle.
**Added by:** spec 03.

### `pd-tenths-mm-type`
`packages/rx-core/src/types/index.ts` — `PdTenthsMm`: integer tenths of a millimetre (63.5 mm → `635`).
**Use instead of:** a float millimetre.
**Added by:** spec 03.

### `money-type`
`packages/rx-core/src/types/index.ts` — `Money` `{ amountMinor, currency }` (ISO-4217).
**Use instead of:** float prices, Shopify decimal strings, or a second money type.
**Added by:** spec 03.

### `prescription-type`
`packages/rx-core/src/types/index.ts` — `Prescription`, `Eye`, `Pd`, `RxType` (`SINGLE_VISION` | `PROGRESSIVE` | `READING` | `NON_PRESCRIPTION`).
**Use instead of:** redeclaring a prescription shape in server or storefront code.
**Added by:** spec 03.

### `rx-limits-type`
`packages/rx-core/src/types/index.ts` — `RxLimits` inclusive SPH/CYL range, optional ADD range, allowed `RxType[]`.
**Use instead of:** per-feature limit structs.
**Added by:** spec 03.

### `catalog-dto-types`
`packages/rx-core/src/types/index.ts` — storefront DTOs `LensGroup`, `Lens`, `OptionGroup`, `OptionValue`, `AddOn`, `CatalogSettings`, `CatalogResponse`, `Selection`.
**Use instead of:** Prisma rows past the catalog service, or a second `Lens` type.
**Added by:** spec 03.

### `rx-core-schemas`
`packages/rx-core/src/schemas/` — zod schemas `diopterSchema`, `axisSchema`, `pdTenthsMmSchema`, `iso4217CurrencySchema`, `moneySchema`, `rxTypeSchema`, `eyeSchema`, `pdSchema`, `prescriptionSchema`, `idSchema`, `rxLimitsSchema`, `lensSchema`, `lensGroupSchema`, `optionGroupKindSchema`, `optionValueSchema`, `optionGroupSchema`, `addOnSchema`, `catalogSettingsSchema`, `catalogResponseSchema`, `selectionSchema`, `prescriptionSubmitBodySchema`, `uploadUrlRequestSchema`. Types are inferred from these schemas, including `PrescriptionSubmitBody` and `UploadUrlRequest`.
**Use instead of:** ad-hoc request/response validators in routes or the configurator client.
**Added by:** spec 03.

### `format-diopter`
`packages/rx-core/src/format/diopter.ts` — `formatDiopter(hundredths)` → signed two-decimal string, `PL` for zero.
**Use instead of:** `toFixed`, string concat, or a second diopter formatter.
**Added by:** spec 03.

### `format-axis`
`packages/rx-core/src/format/axis.ts` — `formatAxis(axisDegrees)` → three-digit optical string (`090`).
**Use instead of:** unpadded axis text.
**Added by:** spec 03.

### `format-pd`
`packages/rx-core/src/format/pd.ts` — `formatPd(pd)` from integer tenths; dual PD as `od/os`.
**Use instead of:** dividing by 10 in UI or ticket code.
**Added by:** spec 03.

### `format-eye`
`packages/rx-core/src/format/eye.ts` — `formatEye(eye)` compact one-eye Rx (`-2.25/-0.50x180`).
**Use instead of:** hand-building `_rx_od` / `_rx_os` strings.
**Added by:** spec 03.

### `bundle-line-properties`
`packages/rx-core/src/cart/bundle-properties.ts` — `buildBundleLineProperties` / `readBundleProperties` / `parsedToBuildInput` for nested cart line keys (`_bundle_id`, `_bundle_role`, `_item_id`, `_option_ids`, `_addon_ids`, `_rx_ref`, `_rx_od`/`_rx_os`/`_rx_pd`, visible `Prescription`). Id lists are JSON arrays. Constants `BUNDLE_ROLES`, `BUNDLE_PROPERTY_KEYS`, `PRESCRIPTION_ON_FILE`. Types `BundleRole`, `BuildBundleLinePropertiesInput`, `FormattedRxProperties`, `ParsedBundleLineProperties`.
**Use instead of:** hand-written `_bundle_*` keys in the configurator or the orders webhook.
**Added by:** spec 03.

### `rx-core-root-exports`
`packages/rx-core/src/index.ts` — the package's only barrel. Every public root export:

Values: `BUNDLE_PROPERTY_KEYS`, `BUNDLE_ROLES`, `PRESCRIPTION_ON_FILE`, `buildBundleLineProperties`, `parsedToBuildInput`, `readBundleProperties`, `formatAxis`, `formatDiopter`, `formatEye`, `formatPd`, `addOnSchema`, `axisSchema`, `catalogResponseSchema`, `catalogSettingsSchema`, `diopterSchema`, `eyeSchema`, `idSchema`, `iso4217CurrencySchema`, `lensGroupSchema`, `lensSchema`, `moneySchema`, `optionGroupKindSchema`, `optionGroupSchema`, `optionValueSchema`, `pdSchema`, `pdTenthsMmSchema`, `prescriptionSchema`, `prescriptionSubmitBodySchema`, `rxLimitsSchema`, `rxTypeSchema`, `selectionSchema`, `uploadUrlRequestSchema`, `OPTION_GROUP_KINDS`, `RX_TYPES`.

Types: `BundleRole`, `BuildBundleLinePropertiesInput`, `FormattedRxProperties`, `ParsedBundleLineProperties`, `AddOn`, `Axis`, `CatalogResponse`, `CatalogSettings`, `Diopter`, `Eye`, `Lens`, `LensGroup`, `Money`, `OptionGroup`, `OptionGroupKind`, `OptionValue`, `Pd`, `PdTenthsMm`, `Prescription`, `PrescriptionSubmitBody`, `RxLimits`, `RxType`, `Selection`, `UploadUrlRequest`.
**Use instead of:** importing from a file under `packages/rx-core/src/` other than this barrel, or redeclaring any of these names.
**Added by:** spec 03.
