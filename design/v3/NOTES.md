# v3: impeccable (critique, audit, polish)

**Brand (fixed input).** This version uses the user-supplied VirtualTry brand system: tryon2, `specs/brand` plus `virtualtry-latest/app/styles/brand-tokens.css`. Brand colour, Geist and the signature shadow override impeccable's font and colour preferences. Tokens keep the `--la-` prefix and each one names its `--vtb-` source. Merchant override is optional, and the defaults are the brand.

**Starting point.** v3 began as an exact copy of v2. Every change since then is in v3 only. v1 and v2 are frozen.

**Method.**
- `impeccable context --target design/v3` returned NO_PRODUCT_MD with SCOPED_EXISTING_ALLOWED, so this was a scoped refinement of an existing design.
- The critique used two isolated agents. **A** did the design review: Nielsen heuristics, persona walk-throughs and the cognitive-load check. **B** ran the detector plus a browser overlay at 1280 and 375.
- Impeccable's questions to the user were skipped because the coordinator said not to ask, so every call below was made here.
- PRODUCT.md and DESIGN.md were not written. A scoped polish doesn't need them, and DESIGN-SYSTEM.md is produced after approval.

**Scores (before polish).**
- Heuristics: 27/40 (Acceptable).
- Detector: three hits.
  - Two are false positives: `overused-font` (Geist is pinned by the brand) and `tiny-text` (`font-size:0` on the mobile step links, which hide their labels on purpose).
  - One is real: `#tab-upload` text was muted on bg-deep at 4.41:1. It is fixed.

**New file:** `polish.css`, linked after `motion.css`. Every value it uses is a token.

## What changed from v2, and why

### P1: blocking issues
| Change | Why |
|---|---|
| Pictograms are 32px on mobile (`--la-pictogram-sm`) and h2 is 22px (`--la-text-xl-sm`) | Step-1 prices were clipped at 375px. |
| Nothing paid is pre-selected on step 5–6. Tint is "None", swatches are hidden, and no thickness is checked. 1.67 is marked "Recommended for your SPH −9.00…" and Continue waits for a thickness. | The brief bans pre-ticked add-ons. v2 had 1.67 and a solid tint pre-selected, which inflated the total by $105. |
| Focus is a 2px ink outline at a 3px offset (`--la-focus-outline`, `--la-focus-offset`). The primary button uses a 5px offset so the signature shadow stays visible. Inputs keep their orange edge and the accent-soft halo. | The old focus ring was accent-soft on bg (1.13:1, invisible), and it replaced the signature shadow on the primary button. |
| The step-2 Continue checks both eyes. If invalid, it shows a `role=alert` summary, moves focus to it and offers "Go to the first problem". | v2 let an invalid prescription through. |
| The Rx limit is explained at step 2, under OS SPH, in neutral wording: "Strong prescription. We'll only show lenses that suit it." | Customers learned about the limit late, from a red disabled card, which looked like a medical form telling them off. |
| Disabled-card reasons use neutral ink-2 text with a muted icon, and disabled cards get a dashed border. | Red read as an error the customer had caused. |

### P2: should fix
| Change | Why |
|---|---|
| `--la-control-edge` (#898578) is now the edge of inputs, radios, checkboxes and the quantity control. | Brand hairline-2 on white is 1.7:1, which fails WCAG 1.4.11. The new edge is 3.69:1 on white and 3.36:1 on bg. |
| Tab and segment text is ink-2. | It was muted on bg-deep at 4.41:1, the one real detector hit. |
| Choice titles are 16px (`--la-text-base`). Segments, the quantity control and swatches meet the 44px target (`--la-target`, `--la-segment-h`). | Hierarchy and touch targets. |
| Lens prices say "from": Clear from $239, Blue-light from $269. The Clear description says a tint can be added in the next step. | v2 prices understated the real cost. |
| The mobile footer uses grid areas: amount on one row, parts on the next, with nowrap and an ellipsis. | v2's footer wrapped onto three lines at 375. |
| The Rx column heads stick at the top on mobile. | You could lose track of which column is which eye while scrolling. |
| The privacy note sits above the dropzone. After upload the dropzone shrinks, and its label switches between "Replace file" and "Choose file". Uploads are checked for file type and size (10 MB max) and show an inline error. | Trust comes before the ask. Upload had no error states. |
| A cross-eye difference note replaces the alarming wording. The PD help text gives a way forward ("not sure? we can…") instead of a dead end. | Keeps the tone friendly and away from a clinical form. |
| The axis error appears on blur and then updates live. It no longer shows on arrival. `#errors` simulates a Continue press so you can preview the state. | Don't show an error before the customer has done anything. |
| The footer's `aria-live` moved to `.la-total__amount` (atomic). | Screen readers now hear only the total when it changes, not the whole footer. |
| The page behind is `inert` while the sheet or drawer is open, and Tab stays inside the open layer. | Correct modal semantics. |
| Fonts load without blocking (preload, swapped onload, with a noscript fallback). | v2 found a roughly 2.4s render-blocking delay that also held back JS. |
| Copy and cleanup: review says "Entered by you" (not "Typed in") and "Plus progressive" (not ", clear"). The duplicate review total is removed. Inline styles became the `.la-subgroup` class. `::selection` is styled. | Consistency, and every value comes from a token. |

## Audit results (after polish)
| Check | Result |
|---|---|
| Contrast (AA) | Body text on bg is 5.0:1 or better. Tabs pass. Control edges are ≥3:1. Accent is used only for fills and the signature shadow, never for small text on bg (accent on bg is only 3.23:1). Accent-deep on bg is 5.79:1. |
| Focus | Visible on every control, and the signature shadow survives focus. |
| Targets | 44px for choices, segments, the quantity control, swatches and icon buttons. |
| 375px | `scrollWidth` is 375 on all five pages, the cart, the upload tab and the error state. No JS errors. |
| States | Covered: errors (Rx, axis, upload), empty (no file, tint none), and disabled (SKU with its reason; Continue with a hint). |
| Reduced motion | Unchanged from v2 (opacity only). |

## Left open (recorded rather than fixed)
- **Thickness is still chosen from words.** A lens-edge picture comparing 1.60, 1.67 and 1.74 would help, but it needs real artwork.
- **A "best match" shortcut.** For a strong prescription, the seven steps could offer one tap to the recommended setup, with the full steps as an optional detour. This is a product decision.
- **The SPH select has 129 options and can't be typed into.** Production should use a numeric stepper or combobox.
- **Mobile chrome.** The header, progress bar and footer take about 30% of the viewport at 375×812. That is acceptable for a sheet but worth testing on device.
- **Mobile progress links stay in the tab order** (with `pointer-events:none`). The component should make them non-interactive on mobile.
- **Review shows Axis 90 for the right eye.** That is prototype data, not something the flow derives.
- **Thickness tiles differ in height** because their descriptions differ in length. Kept because the reason text matters more.
- **Two deliberate deviations from the brand:**
  - The control edge is darker than brand hairline-2.
  - Focus on non-input controls is an ink outline, not the brand's orange halo. Inputs keep the orange edge and halo.
- **The hard offset shadow is kept** even though impeccable treats it as a craft-floor flag, because the brand pins it. It appears only on the primary button and the eyebrow pill.
- **Geist Mono is not used.** Prescription numbers use tabular figures in Geist.

## Previewing states
- `prescription.html#errors`: the Rx error summary.
- `prescription.html#upload`: the upload tab.
- `review.html#cart`: the cart drawer after add to cart.

Note: impeccable reports that v4.8.0 is available. It was not updated during this run.
