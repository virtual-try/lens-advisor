# docs — research and raw planning

Everything the spec set in `../specs/` rests on. Specs cite these files; nothing here is an instruction
to implement.

## research/ — looked up 2026-11-07, with sources

| File | What it covers |
|---|---|
| [stack.md](research/stack.md) | Shopify React Router 7 template, Polaris web components, theme app extensions, app proxy, nested cart lines vs Cart Transform, managed pricing, webhooks and protected customer data, Neon + Prisma, Render, S3, pg-boss |
| [libraries.md](research/libraries.md) | Library choices with versions: Preact/Vite, zod, pdfkit, Resend SDK, AWS SDK v3, pg-boss, Playwright |
| [models.md](research/models.md) | The model ids on each spec's `**Model:**` line, checked against provider pages |

## planning/ — the raw planning trail

| File | What it covers |
|---|---|
| [brief.md](planning/brief.md) | The user's messages verbatim and the MVP in/out lists |
| [intake.md](planning/intake.md) | Every intake question and answer, including the brand change and the cart decision |
| [dag.md](planning/dag.md) | Every dependency edge and what it consumes; edges removed; critical path |
| [splits.md](planning/splits.md) | Feature → spec mapping, rejected splits, size note |
| [validator.md](planning/validator.md) | The final `validate-specs.py` output |

The blueprint the MVP was cut from is `../lensadvisor_blueprint.html`. The configurator design lives in
`../design/` (brief, v1, v2, v3).
