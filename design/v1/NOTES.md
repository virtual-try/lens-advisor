# v1 — gpt-taste (layout, type, colour, composition)

**Brand input:** VirtualTry brand system, fixed input (tryon2 `specs/brand/VirtualTry-Brand-System.html`
+ `virtualtry-latest/app/styles/brand-tokens.css`). It replaced the brief's original "Open" brand
mid-stage; v1 was redone in the brand before v2 started.

## Direction

A calm shopping conversation on warm Bone paper: one question per step, big plain-language choice
cards, and the numbers (SPH, CYL) introduced by a human name first so it never reads as a medical form.
The brand shows up in exactly three places — the ink primary button with its orange offset shadow,
the orange selected-radio fill, and the orange "current step" segment — and everything else stays ink,
muted and hairline so the configurator sits quietly inside a merchant theme.

## Type and colour

- **Type:** Geist (brand `--vtb-font-sans`) at 400/500 only, per the brand's storefront rule; system
  stack fallback. No Bricolage or Instrument Serif. Headings are Geist 500 with -0.02em tracking (the
  display-face "never below 700" rule therefore never applies). 16px inputs to avoid iOS zoom.
  **Geist Mono for Rx numbers: not used.** Tabular figures in Geist already line the numbers up, and a
  monospace numeric grid is exactly the "medical form" look the brief bans; it would also add a font load.
- **Colour:** brand tokens transcribed exactly (`--la-*`, each commented with its `--vtb-*` source).
  Orange is reserved for: selected radio/checkbox fill (with white mark), current-step segment, link
  underline, focus ring tint, primary button shadow. Volt appears once, as the dot in the "Best match"
  badge. Errors and Rx-limit reasons use `--la-accent-deep` (#B82500) text — the brand has no separate
  error red, and accent-deep is its documented "text" shade of the accent.
- **Stand-in theme** (`theme.css`, `--theme-*` tokens) uses Georgia so it is obvious the configurator
  carries its own type rather than the theme's. Theme values are not part of the design.

## Seeded randomisation (gpt-taste §1, adapted)

Seed = character count of `brief.md` at the start of the stage (3498), `random.Random(3498)`:
`accent: plum` (superseded by the brand's Signal Orange), `step-1 layout: stacked list rows`,
`progress: labelled segmented rail`, `surface: warm paper` (matches brand Bone), `lens groups: accordion`.

## Screens

| File | Shows |
| --- | --- |
| `product.html` | Stand-in PDP + configurator open on Step 1 (no option preselected; Continue disabled until one is chosen). |
| `prescription.html` | Step 2, "Type it in" tab with the AXIS-required error on the right eye; `#upload` opens the Upload tab (dropzone, camera, file chip with remove, encrypted-storage note). |
| `lenses.html` | Steps 3–4: lens families as an accordion; "Essential" disabled with the Rx-limit reason. |
| `options.html` | Steps 5–6: thickness tiles (1.50 disabled for this Rx), tint + colour swatches, extras checkboxes (none ticked), running total in the footer. |
| `review.html` | Step 7 summary with per-step Edit links; "Add to cart" (or `#cart`) opens the cart drawer with one bundled line and an "Includes" list. |

Shared: `tokens.css` (every custom property), `configurator.css` (component, reads tokens only),
`theme.css` (stand-in merchant theme), `proto.js` (prototype interactions, no libraries).
The Geist 400/500 Google Fonts link needs a network connection; offline it falls back to the system stack.

## gpt-taste rules set aside (the brief wins)

- **AIDA structure, hero architecture, 2-line hero rule, massive section spacing, creative nav bar:** this
  is a configurator inside someone else's PDP, not a landing page.
- **Font list (Satoshi/Cabinet/Outfit/Geist, never Inter):** brand fixes Geist; no randomised font.
- **GSAP, ScrollTrigger, pinning, scrubbing, card stacking, hover scale-105:** banned by the bundle budget;
  motion is v2's job, CSS/WAAPI only.
- **Bento grids, marquees, horizontal accordions, testimonial carousels, inline typography images:** no
  place in a task flow.
- **picsum imagery, radial blurs, grain, mesh gradients:** the brief bans decorative gradients and
  anything fighting the merchant theme; prototypes open offline. The frame is a line drawing.

Kept: seeded choices, button text contrast, the meta-label ban (no "STEP 01" caps labels; step count
is sentence case and only on mobile), card restraint (3–4 choices per group), no horizontal scroll
(`overflow-x: clip` on the page), no emojis, reduced-motion respect.

## Known rough edges handed to later stages

- Mobile footer: the price breakdown line wraps to two lines at 375px.
- Focus ring is the brand's accent-soft halo; its contrast against Bone has not been checked.
- Input edges use the brand hairline-2, which is light for a form control.
