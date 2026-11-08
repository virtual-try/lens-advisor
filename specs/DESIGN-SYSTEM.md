# Design system — storefront configurator

**Source:** design/v3 (approved 2026-11-07) · tokens from `design/v3/tokens.css`, motion from
`design/v2/NOTES.md` (kept unchanged in v3) · **brand input: user-supplied — VirtualTry brand system**
(tryon2 `virtualtry-latest/app/styles/brand-tokens.css`), a fixed input.

Applies to the storefront configurator (`packages/configurator`) only. The admin uses Polaris web
components with no custom CSS (INV-7).

**This is a closed list.** A token not listed here does not exist. Raw colour, size or duration values
appear only in this file, `packages/configurator/src/styles/tokens.css` (spec 04) and `design/`. If a
token is genuinely missing, add it here in the same session and say so in the spec's Log.

## Direction

Bone and ink surfaces, one Signal Orange accent kept for actions (at most about 10% of any surface), Geist
on controls, the offset signature shadow on the single primary button of each view. Calm and clinical
without feeling like a medical form; nothing bounces.

## Theme

Tokens sit on `:host` of the `<lens-configurator>` shadow root, so the merchant theme cannot leak in and
the configurator cannot leak out. Light only in MVP. **Merchant-overridable:** `--la-accent`,
`--la-font-family`, `--la-radius` (defaults are the brand values; the block settings in spec 04 set them).

## Colour tokens

| Token | Value | Use |
|---|---|---|
| `--la-bg` | `#F7F4EC` | Sheet background (Bone) |
| `--la-bg-deep` | `#ECE6D5` | Quiet fills, segmented tracks |
| `--la-surface` | `#FFFFFF` | Cards, inputs, footer |
| `--la-ink` | `#0A0A09` | Headings, primary button fill |
| `--la-ink-2` | `#1F1E1B` | Body copy |
| `--la-muted` | `#6B6961` | Meta and helper text |
| `--la-muted-2` | `#A09C90` | Decoration only — never text |
| `--la-hairline` | `#E0D9C5` | Borders and dividers at rest |
| `--la-hairline-2` | `#CFC6AC` | Ghost-button edge |
| `--la-control-edge` | `color-mix(in srgb, var(--la-muted) 70%, var(--la-hairline-2))` (= `#898578`) | Input, radio, checkbox edges (3:1; approved brand deviation) |
| `--la-accent` | `#FF3D00` | Signal Orange: primary action, selected state, signature shadow. Never under ink text |
| `--la-accent-2` | `#C8FF00` | Volt: dots and chips only — never text |
| `--la-accent-soft` | `#FFE0D2` | Input focus halo, selected tint, change highlight |
| `--la-accent-deep` | `#B82500` | Error and limit text; text on `--la-accent-soft` |
| `--la-positive` | `#00A85A` | Success states only |
| `--la-on-accent` | `#FFFFFF` | Text on orange (never ink on orange) |
| `--la-on-ink` | `#F7F4EC` | Text on ink (primary button) |
| `--la-swatch-edge` | `rgb(10 10 9 / 0.16)` | Edge around tint swatches |
| `--la-backdrop` | `rgb(10 10 9 / 0.48)` | Modal / drawer backdrop |

**Merchant data colour (the one exception):** an option value's `swatch` colour (spec 19, stored as data)
is applied as an inline custom property on its swatch chip (`--la-swatch-color`) and nowhere else (spec 28).

## Typography

| Token | Value | Use |
|---|---|---|
| `--la-font-family` | `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | Everything; Geist 400/500 only, loaded non-blocking |
| `--la-font-numeric` | `tabular-nums` | Prices, diopters, PD |
| `--la-text-xs` | `0.8125rem` (13px) | Meta, step labels |
| `--la-text-sm` | `0.875rem` (14px) | Helper text |
| `--la-text-md` | `0.9375rem` (15px) | Body, buttons |
| `--la-text-base` | `1rem` (16px) | Choice-card titles |
| `--la-text-input` | `1rem` (16px) | Inputs (stops iOS focus zoom) |
| `--la-text-lg` | `1.125rem` (18px) | Option titles, totals |
| `--la-text-xl` | `1.625rem` (26px) | Step heading |
| `--la-text-xl-sm` | `1.375rem` (22px) | Step heading ≤ 640px |
| `--la-weight-regular` / `--la-weight-medium` | `400` / `500` | Medium is the heaviest weight |
| `--la-tracking-tight` | `-0.02em` | Headings |
| `--la-leading-tight` / `--la-leading-body` | `1.15` / `1.55` | Headings / body |

## Spacing, radii, elevation

| Token | Value |
|---|---|
| `--la-space-1` … `--la-space-7` | `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px` |
| `--la-radius` | `14px` — cards |
| `--la-radius-lg` | `18px` — sheet, drawer |
| `--la-radius-sm` | `10px` — inputs |
| `--la-radius-pill` | `999px` — buttons, segments, badges |
| `--la-mark-radius-box` | `6px` — checkbox corner |
| `--la-border-width` / `--la-border-width-strong` | `1px` / `2px` |
| `--la-shadow-signature` | `4px 4px 0 var(--la-accent)` — primary button only |
| `--la-shadow-signature-hover` | `6px 6px 0 var(--la-accent)` |
| `--la-shadow-sheet` | `0 24px 64px rgb(10 10 9 / 0.22), 0 2px 8px rgb(10 10 9 / 0.08)` |
| `--la-shadow-footer` | `0 -1px 0 var(--la-hairline)` |
| `--la-z-overlay` | `2147483000` |
| `--la-z-footer` | `10` |

## Layout conventions

| Token | Value | Use |
|---|---|---|
| `--la-modal-max` | `720px` | Desktop modal width (> 640px) |
| `--la-drawer-max` | `420px` | Cart drawer reference width |
| `--la-sheet-gap` | `8px` | Space above the mobile bottom sheet |
| `--la-sheet-max-height` | `90vh` | Maximum height of the sheet dialog |
| `--la-label-col` | `168px` | Rx grid label column, desktop |
| `--la-target` | `44px` | Minimum touch target |
| `--la-segment-h` | `44px` | Segmented control height |
| `--la-icon` / `--la-icon-sm` / `--la-icon-md` | `20px` / `16px` / `18px` | Icons |
| `--la-pictogram` / `--la-pictogram-sm` | `40px` / `32px` | Step-1 pictograms |
| `--la-mark` | `22px` | Radio / checkbox indicator |
| `--la-swatch` | `36px` | Swatch chip (tap target stays 44px) |
| `--la-thumb` | `72px` | Frame thumbnail |

- Breakpoint: ≤ 640px = bottom sheet with sticky header, progress and footer; > 640px = centred modal.
- Sheet anatomy: header (title, close), progress strip (3px, one segment per applicable step), scrolling
  body, footer (Back, the step's `Summary`, Continue). No horizontal scroll at 375px.
- Rx grid: OD and OS rows; on phones the label column stacks above the inputs (`design/v3/prescription.html`).

## Component conventions

- **One primary button per view** — ink fill, `--la-on-ink` text, `--la-shadow-signature`.
- **Ghost button** — transparent, `--la-hairline-2` edge, ink on hover.
- **Choice card** (radio/checkbox) — surface, `--la-hairline` edge; selected = `--la-accent` edge + tint
  `--la-accent-soft`; disabled lens = muted text plus a reason line in `--la-accent-deep` with an icon.
- **Inputs** — `--la-control-edge`, `--la-radius-sm`, `--la-text-input`; focus = accent edge +
  `--la-focus-ring`; error text below in `--la-accent-deep`, linked by `aria-describedby`.
- **Tabs / segmented** — `--la-bg-deep` track, `--la-segment-h`, sliding indicator.
- **Swatch** — `--la-swatch` chip with `--la-swatch-edge`, text name beside or below; selected ring.
- **Price summary** — tabular numbers; "Included" for zero deltas; total in `--la-text-lg`.
- **No paid option pre-selected** and no add-on pre-ticked (v3 fix; specs 28, 29).

## States and motion

States: rest, hover (fine pointers only), pressed, selected, focus-visible, disabled (with a reason),
error, loading (skeleton rows in the sheet), empty (block hides the button).

Focus: text inputs use the accent edge + `--la-focus-ring`; every other control uses
`outline: var(--la-focus-outline)` with `outline-offset: var(--la-focus-offset)` (approved brand deviation).

| Token | Value |
|---|---|
| `--la-focus-ring` | `0 0 0 3px var(--la-accent-soft)` |
| `--la-focus-outline` | `2px solid var(--la-ink)` |
| `--la-focus-offset` | `3px` |
| `--la-transition-duration` / `--la-ease` | `200ms` / `ease` (brand: every hover and colour change) |
| `--la-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--la-ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `--la-ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `--la-dur-press` / `--la-dur-fast` / `--la-dur-modal` / `--la-dur-sheet` / `--la-dur-highlight` | `120ms` / `150ms` / `250ms` / `400ms` / `700ms` |
| `--la-stagger` / `--la-shift` / `--la-press-scale` | `40ms` / `16px` / `0.98` |

| Element | Trigger | Property | Duration | Easing | Reduced motion |
|---|---|---|---|---|---|
| Desktop modal + backdrop | open / close | opacity, scale .96↔1 | modal / fast | ease-out | opacity only |
| Mobile sheet | open / close | translateY 100%↔0 | sheet / modal | ease-drawer | fade |
| Step body | leave / arrive | opacity, ∓/± `--la-shift` | fast / modal | ease-out | opacity only |
| Progress segment | arrive at step | fill left→right | sheet | ease-out | none |
| Radio dot / tick | select | opacity, scale .5→1 | press / modal | ease-out | opacity only |
| Choice card | press / hover-select | scale `--la-press-scale` / border, shadow | press / transition | ease-out / ease | none / unchanged |
| Primary button | hover / press | translate ∓2px, signature shadow 6px / 2px | transition / press | ease | no translate |
| Ghost, icon, tab buttons | press | scale .97 | press | ease-out | none |
| Tab indicator / panel | tab switch | translateX / opacity | modal / fast | ease-in-out / ease-out | instant / unchanged |
| Accordion (lens family) | expand / collapse | height, opacity; items translateY 6px with `--la-stagger` | modal / fast | ease-out | opacity only |
| Disabled-lens reason | shown / tapped | opacity −4px / accent-soft fade | modal / highlight | ease-out | opacity / unchanged |
| Running total | price change | opacity .4→1, 4px | modal | ease-out | opacity only |
| Changed price part | price change | accent-soft highlight | highlight | ease-out | unchanged |
| Inline error | shown | opacity, −4px | fast | ease-out | opacity only |
| File chip | add / remove | opacity, scale .96 | modal / fast | ease-out | opacity only |

Rejected (do not add): count-up prices, shake on errors, hover lift on cards, entrance stagger on step 1.
The cart drawer and "Added" tick in `design/v3/review.html` are the theme's, shown for reference only.

## Accessibility floor

- WCAG 2.2 AA: text 4.5:1, control edges and focus 3:1; `--la-muted-2` and `--la-accent-2` never carry text.
- Every target ≥ `--la-target`. Inputs at `--la-text-input` (no iOS zoom).
- Dialog semantics, focus trapped while open and returned to the trigger; page behind is `inert`.
- Every field has a visible label; errors are announced and linked; disabled lenses keep their reason
  readable by screen readers.
- `prefers-reduced-motion: reduce` uses the fallbacks above.
