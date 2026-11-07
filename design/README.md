# Lens configurator: design

**Current version: v3**

Brand: VirtualTry brand system (tryon2), a fixed input that replaced "Open" on 2026-11-07. See `brief.md`, under Brand input.

| Stage | Folder | Skill | What it did |
|---|---|---|---|
| 1 | `v1/` | gpt-taste | Layout, brand tokens and the five static screens (product, prescription, lenses, options, review), adapted to a modal on desktop and a bottom sheet on mobile. |
| 2 | `v2/` | animate | Motion: step transitions, sheet open/close, select feedback, reveal of disabled SKUs, price updates, and the hand-off from add-to-cart to the cart drawer. Respects reduced motion. |
| 3 | `v3/` | impeccable | Two-agent critique, then polish: focus, contrast, 44px targets, 375px layout, no pre-selected paid options, and error, empty and disabled states. |

Each folder opens straight from disk (start at `product.html`). There is no build step. Each folder's `NOTES.md` records its decisions.

**Approval: approved 2026-11-07** — v3 approved by the owner, including the two brand deviations (`--la-control-edge` #898578 for 3:1 control edges; ink focus outline instead of the orange halo on non-input controls).
