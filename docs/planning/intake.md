# Intake (2026-11-07) — questions asked and answers, verbatim

Scope boundary: settled before intake — see brief.md (MVP in/out lists, accepted with "yes please").

| Question | Answer |
|---|---|
| Which branding should the LensAdvisor MVP design use? It mainly affects the storefront lens configurator, because the Shopify admin side will use Shopify's own Polaris look. | Open (Recommended) |
| Where should the LensAdvisor MVP app and database be hosted? | Render + Neon (Recommended) |
| Where should uploaded prescription files (encrypted) be stored? | AWS S3 (Recommended) |
| How should lab job tickets (PDF/CSV) be emailed to labs? | Resend (Recommended) |

Not asked (conventional default, recorded in spec 00): stack follows Shopify's official app template; multi-user = one Shopify shop per tenant via Shopify OAuth (no separate user accounts).

## Change — 2026-11-07 (same session, while v1 was being designed)

User: "please change colors to our nerdware tech theme which we usen in tryon-2 shopify and wordpress plugins"

Resolved to: the **VirtualTry brand system** shared by tryon2's Shopify app (`virtualtry-latest/app/styles/brand-tokens.css`) and WooCommerce plugin (`woo-SAAS-App-tryon-Glasses/includes/css/brand-tokens.css`), source `tryon2/specs/brand/VirtualTry-Brand-System.html`. The string "nerdware" does not appear in those files; flagged to the user as an assumption.
Brand answer changes from **Open** to **User-supplied (fixed input)**.

## Change — 2026-11-07, after stack research

Q: "How should the LensAdvisor MVP group frame + lens + upgrades in the cart? …" → **Nested lines only (Recommended)**.
Effect: Cart Transform function spec and cart quantity-sync spec dropped (Shopify removes child lines with the parent); Cart Transform merge → post-MVP. Set renumbered from 37 to 35 specs (00–34).

Not asked (conventional default, docs/research/stack.md §6): billing uses **Shopify managed App Pricing** (plans defined in the Partner Dashboard, Shopify-hosted plan page) — the current default for new public apps; the app only reads the active subscription. Plan names/prices are an owner decision → README Open questions.
