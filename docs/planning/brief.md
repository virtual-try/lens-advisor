# Brief (verbatim from the conversation, 2026-11-07)

Source plan: `lensadvisor_blueprint.html` (the only file in the repo at start).

User: "we have a pproject plan in .html file . that is the only file we have . can you read how big this project is ?"
User: "if you compare it with our ai-gallery ? where it stands same size?"
User: "what if we build just mvp for now ? then comparison ?"
User: "yes please" — in reply to: "Shall I write the MVP spec set (specs, README index and PROGRESS.md) in lens-advisor/specs/, set up the same way as ai-gallery's?"

## MVP scope as proposed by the assistant and accepted

In:
1. Shopify Remix app scaffold, multi-tenant auth, Postgres
2. DB schema with prescriptions encrypted
3. Merchant admin: lens catalog and pricing
4. Merchant admin: lens groups, upgrades and Rx limits setup
5. Rx limits engine (shared library with tests)
6. Storefront configurator (theme app extension, web component): the 7-step flow, about 3 specs — Rx entry/upload, lens and upgrades, review and add to cart
7. Prescription file upload to encrypted storage
8. Cart bundling: separate lines with quantity sync, plus the Shopify cart-merge (Cart Transform) function
9. Lab code compiler (token replacement)
10. Order webhook -> lab job ticket as PDF/CSV, emailed to the lab
11. Flat-rate billing through Shopify's billing API
12. Shopify mandatory privacy and uninstall webhooks
13. Design tokens and shared components, e2e tests, verification pass

Out (later): POS extension, all 9 live lab connections, AI prescription reading (OCR), picture matrix, contact lenses (avoids FTC Contact Lens Rule), LensAdvisor migrator, exam booking, Arabic/RTL, Shopify Plus single-line bundling, most of the 26 JS events.
