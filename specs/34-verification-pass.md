# Spec 34 — Verification pass

**Status:** Not started
**Depends on:** Spec 33
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `specs/INVENTORY.md`
**Reuses:** `INVARIANTS.md`, `ARCHITECTURE.md`, `DESIGN-SYSTEM.md`, `INVENTORY.md`

## Goal

The final gate. Prove from a clean state that what the spec set promised is actually true — and record
every place it was not. This spec observes and reports; anything found becomes a new spec.

## Scope

- Clean rebuild: fresh `pnpm install --frozen-lockfile`, typecheck, lint, build (app + configurator bundle).
- Every earlier spec's `Done when` re-checked against the real artifact, not the ticked box.
- Whole unit suite and whole e2e suite, each in one go.
- Fold `specs/inventory/*.md` into `INVENTORY.md`; duplication sweep.
- Steering docs re-read against the code; every `INV-1`…`INV-10` checked by ID.
- Storefront budget: the loader file in `extensions/lens-configurator/assets/` is ≤ 10 KB (theme-check
  guidance); record the configurator bundle size from the build output.

## Explicit non-scope

- Fixing anything found → each finding becomes its own numbered spec in `README.md` and `PROGRESS.md`.
- New features of any kind.

## Steps

1. Clean install; `pnpm typecheck`, `pnpm lint`, `pnpm build`; record real output.
2. `pnpm test`, then `pnpm test:e2e`; record both runner summary lines verbatim.
3. Walk every earlier spec's `Done when`; note every box that does not hold.
4. Fold inventory fragments; run the sweep (near-duplicate exports, raw hex outside `tokens.css`/`design/`,
   inventory entries whose file is gone).
5. Re-read `ARCHITECTURE.md` against the tree (structural invariants 1–7 by grep) and `INVARIANTS.md` by ID.
6. Re-open every `[requires: …]` box left open and every Examples table; grep production code for stubs
   named in `## Wiring` sections.
7. Re-read `DESIGN-SYSTEM.md` against `packages/configurator/src/styles/tokens.css` and component styles.
8. Run `shopify app deploy --dry-run` if available, else `shopify app config validate`; record output.
9. Record everything in the Log with tool output; file follow-up specs.

## Done when

- [ ] Clean install + `pnpm typecheck` + `pnpm lint` (0 errors, 0 warnings) + `pnpm build` all pass. [static]
- [ ] Whole unit suite and whole e2e suite pass from a clean install; summary lines quoted verbatim in the Log. [suite]
- [ ] Every inventory fragment is folded into `INVENTORY.md`. [static]
- [ ] Every earlier spec's `Done when` re-checked and the result recorded. [static]
- [ ] Duplication sweep run; findings in the Log. [static]
- [ ] Every `INV-N` in `INVARIANTS.md` checked against the tree, by ID. [static]
- [ ] No stub named in any `## Wiring` section remains in production code. [static]
- [ ] No token used outside `DESIGN-SYSTEM.md`'s list. [static]
- [ ] The theme-extension loader asset is ≤ 10 KB (size from the build output). [static]
- [ ] Every finding has a follow-up spec or a line saying why it is accepted. [static]
