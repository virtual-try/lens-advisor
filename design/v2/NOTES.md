# v2 — animate (v1 + motion)

**Brand input:** VirtualTry brand system, fixed input (see `../brief.md`). The brand's motion rule
is `--vtb-transition: .2s ease` for every hover, no bounces, no springs. v2 keeps that for hovers and
colour changes and adds stronger ease-out curves only for things entering, leaving or moving. Nothing bounces.

v2 = v1 copied unchanged, then: motion tokens added to `tokens.css`, new `motion.css` (loaded after
`configurator.css`) and `motion.js` (WAAPI helpers), `proto.js` calls the helpers when present,
and `product.html` gets `data-enter-on-load`. No layout, colour or copy changes, except one bug fix
below.

## The gate (frequency, then purpose)

- **Occasional** (opened once or twice per purchase): sheet/modal, step change, accordion, cart
  drawer. These get standard motion.
- **Tens of times per session**: option select, hover, press, price update. These stay under 250ms
  and only use opacity, colour and small transforms.
- **Rare**: the "Added to your cart" tick draws itself once. That is the only delight in the flow.
- **Rejected, no motion:**
  - Count-up/rolling price digits. The shopper reads that number; it should not move for show.
  - Shake on validation errors. It reads as scolding, and the brief says no medical-form feel.
  - Hover lift or scale on choice cards. They are seen dozens of times; a border colour change is enough.
  - `<details>` help content height. The chevron turns; the content appears instantly.
  - PD one/two segment. An instant swap is clearer for two options.
  - Any entrance stagger on step 1's four cards. The step change already moves the body.
  - Keyboard (Esc to close, arrow keys between tabs) gets the same short exits as clicks, and none of
    it is slowed down for show.

## Motion table

| Element | Trigger | Property | Duration | Easing | Reduced-motion fallback |
| --- | --- | --- | --- | --- | --- |
| Desktop modal (`.la-sheet` > 640px) + backdrop | "Select lenses" / first visit to product page | opacity 0→1, transform scale(0.96)→1; backdrop opacity | 250ms (`--la-dur-modal`) | `--la-ease-out` | opacity only, 250ms linear |
| Desktop modal + backdrop | Close button, Esc, Add to cart | opacity 1→0, scale→0.96 | 150ms (`--la-dur-fast`) | `--la-ease-out` | opacity only |
| Mobile bottom sheet (≤ 640px) | open | transform translateY(100%)→0 | 400ms (`--la-dur-sheet`) | `--la-ease-drawer` | opacity fade, no slide |
| Mobile bottom sheet | close | translateY(0→100%) (exits the way it came) | 250ms | `--la-ease-drawer` | opacity fade |
| Step body (`.la-body`) | Continue / Back / step link / Edit link: leaving | opacity 1→0, translateX(∓16px) | 150ms | `--la-ease-out` | opacity only |
| Step body | arriving at the next step | opacity 0→1, translateX(±16px→0); direction follows forward/back | 250ms | `--la-ease-out` | opacity only |
| Current progress segment | arriving at a step | background-size 4%→100% of the 3px strip (fills left to right) | 400ms | `--la-ease-out` | none, segment shows filled |
| Radio dot / checkbox tick (`.la-mark::after`) | option selected | opacity 0→1, transform scale(0.5)→1 (never from 0) | 120ms opacity, 250ms scale | `--la-ease-out` | opacity only, 120ms linear |
| Radio / checkbox fill | option selected | background-color, border-color | 120ms (`--la-dur-press`) | `--la-ease-out` | unchanged (colour) |
| Choice card | press (`:active`) | transform scale(0.98) | 120ms | `--la-ease-out` | none |
| Choice card | hover (fine pointer only) / selected | border-color, box-shadow | 200ms (`--la-transition-duration`) | `ease` (brand) | unchanged (colour) |
| Primary button | hover (fine pointer only) | transform translate(-2px,-2px), signature shadow 4px→6px | 200ms | `ease` (brand) | colour/shadow only, no translate |
| Primary button | press | transform translate(2px,2px), shadow→2px (presses into its shadow) | 120ms | `ease` | none |
| Ghost / icon / tab buttons | press | transform scale(0.97) | 120ms | `--la-ease-out` | none |
| Ghost button | hover (fine pointer only) | background, colour, border to ink | 200ms | `ease` (brand) | unchanged |
| Tab indicator (`.la-tabs::before`) | switching Type it in / Upload | transform translateX | 250ms | `--la-ease-in-out` | instant |
| Tab panel | switching tabs | opacity 0→1 | 150ms | `--la-ease-out` | unchanged (opacity) |
| Lens family accordion panel | expand | height 0→auto (measured), opacity | 250ms | `--la-ease-out` | opacity only, 150ms linear |
| Lens SKUs inside a panel | expand | opacity, translateY(6px→0), 40ms stagger (`--la-stagger`) | 250ms each | `--la-ease-out` | no stagger, no movement |
| Lens family accordion / cart "Includes" | collapse | height→0, opacity | 150ms | `--la-ease-out` | opacity only |
| Chevrons | expand / collapse | transform rotate | 200ms | `--la-ease-out` | unchanged (small rotation kept) |
| Disabled-SKU reason (`.la-choice__reason`) | shown (page load or group opens) | opacity, translateY(-4px→0), 150ms delay after the card | 250ms | `--la-ease-out` | opacity only |
| Disabled-SKU reason | tap on the disabled card | background-color accent-soft→transparent | 700ms (`--la-dur-highlight`) | `--la-ease-out` | unchanged (colour) |
| Tint colour swatches row | tint changed from / to "No tint" | height + opacity (same as accordion) | 250ms in / 150ms out | `--la-ease-out` | opacity only |
| Swatch ring | colour selected | box-shadow | 120ms | `--la-ease-out` | unchanged |
| Running total (`[data-sum=total]`) | any priced option changes | opacity 0.4→1, translateY(4px→0) | 250ms | `--la-ease-out` | opacity only |
| Changed price part (frame/lens/upgrades) | its value changes | background-color accent-soft→transparent | 700ms | `--la-ease-out` | unchanged (colour) |
| Inline error (`.la-error`) | shown | opacity, translateY(-4px→0) | 150ms | `--la-ease-out` | opacity only |
| Uploaded file chip | file added | opacity, scale(0.96→1) | 250ms | `--la-ease-out` | opacity only |
| Uploaded file chip | removed | opacity, scale(1→0.96) | 150ms | `--la-ease-out` | opacity only |
| Configurator → cart drawer | Add to cart | sheet exits (150ms / 250ms mobile); drawer starts 120ms later | (see rows) | — | both fade |
| Cart drawer + backdrop | open | transform translateX(100%)→0; backdrop opacity | 400ms | `--la-ease-drawer` / `--la-ease-out` | opacity only |
| Cart drawer | close (X, backdrop, Esc) | translateX(0→100%), backdrop opacity | 250ms | `--la-ease-drawer` | opacity only |
| "Added to your cart" tick | drawer has opened | stroke-dashoffset 14→0, 400ms delay | 400ms | `--la-ease-out` | none, tick shown |

Every interruptible state uses transitions or cancellable WAAPI animations: re-opening a closing
accordion starts from its current height, and rapid option changes restart the price settle from where
it is, not from zero.

## Ingredients

- **Tools:** CSS transitions for every state toggle; CSS keyframes only for one-shot entrances of
  elements that were just un-hidden (error, file chip, disabled reason, progress fill, tick); WAAPI
  (`motion.js`, ~150 lines, no library) for measured height, step out/in, price settle and highlights.
- **Properties:** transform and opacity, plus colour. Two exceptions, both small: accordion
  `height` (the skill's sanctioned case) and the progress strip's `background-size`. The strip
  can't use a transform pseudo-element because the link clips overflow for its ellipsis.
- **New tokens:** `--la-ease-out`, `--la-ease-in-out`, `--la-ease-drawer` (from the animate skill's
  table), `--la-dur-press|fast|modal|sheet|highlight`, `--la-stagger`, `--la-shift`, `--la-press-scale`.
  `motion.js` reads them from computed style, so CSS and JS share one source.
- **Hover gating:** v1's hover rules are reset in `motion.css` and re-applied inside
  `@media (hover: hover) and (pointer: fine)`. Without that, a tap leaves the ghost button inverted to
  ink on phones.

## Bug found and fixed while animating

The current-step segment first used a pseudo-element at `top: -3px`. The link's `overflow: hidden`
clipped it, so the orange segment vanished. It's now a border-box background. This fix is in v2's
`motion.css` only; v1 is untouched.

## Feel-checks (things code can't settle)

- 400ms for the mobile sheet sits at the top of the drawer range. Play it at 3x in the DevTools
  Animations panel on a real phone; drop to 320ms if it feels slow when going back and forth.
- The handoff from sheet exit to drawer entry has 120ms of overlap. Check that it reads as one motion
  and not as two separate things.
- The step slide is only 16px. It should feel like a page turn, not a carousel.

## Found for v3

- The Google Fonts stylesheet is render-blocking. Scripts waited about 2.4s for it in testing, which
  delays every motion hook and the price logic. Load it so it doesn't block.
