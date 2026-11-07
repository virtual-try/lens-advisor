# Design brief — storefront lens configurator (MVP)

Working product name: **LensAdvisor MVP** (internal codename; the shopper never sees our brand — the
configurator lives inside each merchant's Shopify theme).

## What it is
A Shopify app for optical retailers selling prescription glasses online. On a frame's product page the
shopper clicks **"Select lenses"** and a configurator opens that walks them through 7 steps:
Rx type → prescription (type it or upload a photo/PDF) → lens group → specific lens → options
(material/index, tint type, colour) → add-ons (coatings, case) → review & add to cart.
The one job: **get a correct prescription and a valid lens choice into the cart without the shopper
feeling they are filling in a medical form.**

Users: shoppers on phones (most traffic), aged 25–65, often unsure what SPH/CYL/AXIS/ADD/PD mean.

## Screens to design (static prototypes)
1. `product.html` — a plain frame product page (stand-in for a merchant theme) with the "Select lenses"
   button, and the configurator open on **Step 1 Rx type** (single vision / progressive / reading /
   non-prescription, each with a one-line explanation and "from $X").
2. `prescription.html` — **Step 2**: two tabs, "Enter manually" (OD/OS rows: SPH, CYL, AXIS, ADD; PD
   single or dual; inline validation such as "AXIS is required when CYL is set") and "Upload" (drag/drop
   or camera, file chip with remove, accepted types, privacy note "stored encrypted").
3. `lenses.html` — **Steps 3–4**: lens groups as cards, then lens SKUs; some SKUs disabled with the
   reason "Not available for your prescription (SPH −9.00 exceeds −8.00)" — the Rx-limits moment.
4. `options.html` — **Steps 5–6**: option matrix (material index, tint type, colour swatches) and add-on
   checkboxes, with a sticky running price summary (frame + lens + upgrades = total).
5. `review.html` — **Step 7** review (frame, prescription summary with edit links per step, lens,
   options, total) and the **cart drawer** after adding, showing frame+lens+upgrades as ONE bundled line
   with a collapsible "includes" list.

Desktop: centered modal (max ~720px wide) with a step progress indicator. Mobile (375px): full-height
bottom sheet, sticky footer with Back / Continue and the total.

## Stack constraints
- Rebuilt later as a **Preact web component** (`<lens-configurator>`) shipped in a Shopify theme app
  extension, rendered in **Shadow DOM**. No Tailwind at runtime; plain CSS with custom properties.
- **It must sit inside unknown merchant themes.** All colours/fonts/radii are CSS custom properties with
  neutral defaults that a merchant can override (accent colour, font family, corner radius). Default font:
  the brand's Geist stack (see Brand input), overridable. Keep the token set small and semantic.
- JS bundle budget is tight (storefront performance): no GSAP, no heavy libs. Motion via CSS transitions
  / WAAPI only. Respect `prefers-reduced-motion`.
- Merchant admin is NOT designed here — it uses Shopify Polaris.

## Brand input
**User-supplied — VirtualTry brand system (tryon2, specs/brand + virtualtry-latest/app/styles/brand-tokens.css), fixed input.**
Colours, radii, the signature primary-button shadow, the `.2s ease` transition and the misuse rules
(one primary per view; signature shadow only on the primary button and eyebrow pill; orange at most
~10% of a surface; white on orange, never ink on orange; Volt never as text; display face never below 700)
override any stage's own font or colour preferences. Storefront font rule: interactive controls use
Geist (sans) only, at most Geist 400/500 or the system stack; Bricolage Grotesque and Instrument Serif
are not loaded in the configurator. Tokens use a `--la-` prefix, each naming its `--vtb-` source.
Merchant override is optional: accent, font family and radius stay overridable, defaults = brand.
(Changed from "Open" on 2026-11-07 at the user's request.)

## Anti-goals
- Must not look like a medical/insurance form (dense grids, all-caps labels, grey boxes).
- No dark-pattern upsell (pre-ticked add-ons, countdowns).
- No decorative gradients, glassmorphism, or illustrations that fight the merchant's theme.
- No layout that needs horizontal scroll on a 375px phone; the Rx grid must work on mobile.
