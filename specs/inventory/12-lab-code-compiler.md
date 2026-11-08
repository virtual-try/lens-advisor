# Inventory fragment — Spec 12 (Lab code compiler)

### `compile-lab-code`
`packages/rx-core/src/lab-code/compiler.ts` (re-exported from `packages/rx-core`) — `compileLabCode(lensOrTemplate, selections?)` compiles the optical lab code for an order line from a base lens template string (or `Lens` object) and chosen customer upgrades/options. Replaces bracketed tokens `[key=DEFAULT]` with selected values or defaults, and applies whole dash-separated segment overrides (e.g. `material` for the first segment). Overrides take precedence over tokens targeting the same segment. Token and override values are inserted as literal strings without regex interpretation (`$&`, `$1`, `.`). Unknown token keys in selections are reported in the `warnings` array (`UNKNOWN_TOKEN <key>`). Templates with no tokens compile to themselves for any selections. Returns `CompileLabCodeResult` (`{ code: string, warnings: string[] }`).
**Use instead of:** manual string replacement or ad-hoc lab code formatting.
**Added by:** spec 12.

### `validate-template`
`packages/rx-core/src/lab-code/validator.ts` (re-exported from `packages/rx-core`) — `validateTemplate(text)` validates a lab code template string according to the grammar: literal text with tokens `[key=DEFAULT]` (key is `[a-z_]+`, default is `[A-Z0-9]*`). Used by admin forms (spec 18) for live preview and input validation. Checks for empty templates (`EMPTY_TEMPLATE`), unclosed brackets (`UNCLOSED_TOKEN`), unopened or malformed brackets (`MALFORMED_TOKEN`), and duplicate token keys (`DUPLICATE_TOKEN <key>`). Returns `TemplateValidationResult` (`{ valid: boolean, errors: TemplateValidationError[], error?: string, tokens: ParsedTemplateToken[] }`).
**Use instead of:** regex matching on template strings or saving unvalidated templates.
**Added by:** spec 12.
