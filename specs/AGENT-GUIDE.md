# Agent guide — how work happens in this repo

You are a fresh session with no prior context. Everything you need is on disk,
and everything you leave behind must be on disk too.

## Read before implementing

In this order, then the spec you were pointed at:

1. `specs/README.md` — what this project is, and the spec index
2. `specs/ARCHITECTURE.md` — folders, layers, data model
   and `specs/INVARIANTS.md` — the cross-cutting rules, by `INV-N` ID
3. `specs/DESIGN-SYSTEM.md` — the closed token list *(skip for non-UI work)*,
   and the screen in `design/v3/` your spec cites
4. `specs/INVENTORY.md` and every file in `specs/inventory/` — what already exists
5. `specs/PROGRESS.md` — **current state, what is actually done, known gaps**

`PROGRESS.md` is the single source of current state. Its status table and the
tail of its Log **outrank any assumption carried in from a previous session**.

## One spec per session

Implement exactly the spec you were given — nothing more. Its `Explicit
non-scope` is **binding**: if you notice work that belongs to another spec, write
one line about it in the Log and leave it alone. Do not start the next spec; a
separate fresh session picks it up.

## Other specs are running right now

This set runs in parallel under Orchestro: other coders are implementing other
specs in other worktrees at this moment, and every PR merges into the same
branch.

- **Write only inside your spec's `**Owns:**` line.** A file outside it that
  seems to need a change is a Log line for the lead, not an edit.
- **Add files, don't edit shared ones.** Routes, nav items, strings, seeds and
  fixtures are split per feature (see `ARCHITECTURE.md`). Add yours beside the
  others.
- **Do not touch the `PROGRESS.md` table or your spec's `**Status:**` line.**
  The lead sets them when it merges your PR. Write your notes in the spec's Log.
  *(Under `spec-run`, which runs one spec at a time, you do update both.)*
- **Record what you created in `specs/inventory/NN-<slug>.md`**, never in
  `INVENTORY.md` itself — see below.

A spec that combines UI and background work, or persistence and realtime state,
or several unrelated routes, is more than one spec. Say so and stop, rather than
doing all of it.

## Claim the GitHub issue before writing code

One spec is one issue is one pull request.

1. **Search first** — `gh issue list --state all --search "Spec NN in:title"`.
   An issue whose title starts with `Spec NN ` already exists on any re-run;
   opening a second one is the failure this ordering prevents.
2. If none exists, create it: title `Spec NN — <spec title>`, labels `spec` and
   `spec:NN`, body = the spec's Goal and `Done when`.
3. Assign it to yourself, then write `#<n>` into the spec's `**Issue:**` header
   line (and, under `spec-run`, the tracker row) — **before** any code.
4. When the spec's `Done when` genuinely passes: branch `spec/NN-<slug>`,
   commit, push, and open a PR whose body says `Closes #<n>`. Move the issue to
   Done on the board if the repo has one; otherwise the merge closes it. **Never
   merge your own PR.**
5. Put the issue and PR URLs in the Log.

`gh` failing is not a reason to abandon the spec — log what failed and do the
work. Skip this section entirely if the project has no GitHub remote.

## The model on the spec is the model to run

Each spec's `**Model:**` line names a tier and one model per provider, sized to
what the spec can damage if it goes wrong. `spec-run` passes the Claude id
through automatically. If you were started by hand on a lower tier than the spec
names, say so in the Log. A `Light` spec that turns out to be `Standard` work
gets **re-tiered and re-run**, not retried at the same tier.

## Verify before you assert

Never write "X is already installed" or "the existing Y" without checking.

- A package claimed as pre-installed → read the root `package.json` and the workspace package's `package.json`.
- A file path → resolve it against the tree.
- A library export → grep the installed types, or check the docs.
- A prior-state claim → find the ancestor spec's `Done when` that establishes it.
- An env-derived value behaving oddly → print what the process actually received
  before suspecting the code.

## Reuse before creating

Before creating any component, hook, constant, type, or util: search
`INVENTORY.md` and `specs/inventory/`, then grep the codebase **for the concept, not just the name you
would have used**. If a near match exists, extend it. Creating a second one is a
review failure.

After creating anything reusable, record it **in this same session** in your
spec's own fragment, `specs/inventory/NN-<slug>.md` — path, purpose, and what
it should be used instead of, in the entry shape `INVENTORY.md` shows. One file
per spec means parallel sessions never conflict on it; the verification pass
folds the fragments into `INVENTORY.md`.

## Design tokens are a closed list

A token not in `DESIGN-SYSTEM.md` does not exist. Never a raw hex value, never a
raw palette class. If a needed token is genuinely missing, add it to
`DESIGN-SYSTEM.md` in this session and say so in the Log — do not invent a
plausible-sounding variant locally.

A UI spec rebuilds its screen from `design/v3/` in the app's own components,
using tokens. **Never paste the prototype's HTML, CSS, or animation code into
the app**, and never edit `design/` — it is the approved reference.

## Unit tests prove every spec

Every spec that creates code writes unit tests for it and runs them. No spec
writes or runs end-to-end tests except the e2e spec near the end.

- Unit runner: **Vitest** (+ **@testing-library/preact** for configurator components; admin routes are tested through their loaders/actions with `testConfig()` from `@shopify/shopify-app-react-router/test-helpers`)
- Tests live: **next to the code, `*.test.ts(x)`**; DB-backed tests need `TEST_DATABASE_URL` (`ARCHITECTURE.md#test-data`)
- **One file:** `pnpm vitest run <path>`
- **Whole unit suite** (every spec, after its own tests): `pnpm test`
- **End-to-end** — `pnpm test:e2e` — **the e2e spec only.** Do not install
  the e2e harness, add an `e2e/` file, or start a browser in any other spec.
- Tick a `[unit]` box only after the command ran and passed **in this
  session, after your last code change**. "Tests added" is not "tests
  passing".

What a good unit test here looks like:

- It names a behaviour — "moving a card to its own column is a no-op" — not a
  function.
- Components are rendered and asserted by role and text: the loading, empty,
  error and populated states, a disabled submit. Not snapshots.
- It mocks at the boundary `ARCHITECTURE.md` names (network client, clock,
  database driver), never the thing under test.

## Evidence is honest, or the box stays open

These four rules exist because breaking them cost more review rounds than any
bug did.

- **Invariants by ID.** Your spec's `**Invariants:**` line lists the
  `INVARIANTS.md` rules it touches, and each has its own `Done when` box. Prove
  each one the way that box says — they are the first thing review checks.
- **No production no-ops.** Wire what your spec's `## Wiring` says is real.
  What it says is stubbed lives in test code only — never `onX = {}`, a
  placeholder service, or a button that does nothing. If the real thing does
  not exist yet, don't render the entry point.
- **Never invent data to tick a box.** A `[requires: …]` box that needs real
  data, a device, or an account stays **open**, with one Log line saying what
  was missing. Made-up IDs, labels or fixtures passed off as real are a
  BLOCKER; an honest open box is not a finding at all.
- **Numbers come from the tool.** Do not type test counts, file sizes or
  hashes into the Log — paste the runner's own summary line from the last run
  (under Orchestro, `orchestro spec verify NN` records them). A claim like
  "copied from the licence file" carries a link at a pinned commit or tag.

Each test you write must **fail if the behaviour it covers is removed**. For
the risky ones — parsers, permission filters, merges of user and automatic
data — break the line, watch the test go red, restore it, and note
"sabotage: <what> → red" in the Log. Every row of your spec's `## Examples`
table is a test case.

## Self-check before you finish

Your spec's `## Self-check` is the reviewer's focus list, given to you first.
Work through every item and write one Log line per item saying what you found —
including "checked, holds". Then check the kind checklists your `**Kind:**`
line names (the skill's `spec-quality.md` §8, summarised in the review
checklist below). Review severity and earlier rulings are in `RULINGS.md`; a
point already ruled out there is not something to redo.

## Acceptance criterion tiering

| Tier | Tag | Meaning |
| --- | --- | --- |
| S | `[static]` | Typecheck, lint, build, or file inspection |
| U | `[unit]` | Unit/component tests that ran — this spec's files, then the whole unit suite |
| R | `[runtime]` | Needs the app running, single process |
| E | `[e2e]` | The end-to-end suite — the e2e spec only |
| F | `[suite]` | Both whole suites from a clean install — the verification pass only |
| X | `[requires: …]` | Needs live external services or multiple clients — list them |

`[static]` is mandatory on every spec, `[unit]` on every spec that creates code. `[requires:]` names its dependencies so
nobody silently reports "passes" on something they could not run.

## Before finishing a spec

1. The spec works end to end within its defined scope.
2. No invariant in `ARCHITECTURE.md` was violated, and every `INV-N` your
   spec lists has its box ticked with a real proof.
3. `pnpm typecheck` clean, `pnpm lint` clean (**0 errors, 0 warnings**), `pnpm build` passes.
4. Every `[unit]` command in the spec's `Done when` has actually been run
   after your last change, with the runner's summary line pasted in the Log.
   Every `## Self-check` item has a Log line. Every open `[requires:]` box has
   its reason.
5. Your `specs/inventory/NN-<slug>.md` records anything new and reusable.
6. The spec's own Log reflects the work **and any verification gaps** (and,
   under `spec-run` only, `PROGRESS.md` too).
7. Nothing outside your `**Owns:**` was edited.
8. The GitHub issue is assigned, the PR is open with `Closes #<n>`, and both
   URLs are in the Log (skip when the project has no GitHub remote).

## Leave the handoff before finishing

Record what was built, what was verified, and — explicitly — **what could not be
verified in this environment**. Progress must reflect the actual state, not the
intended state. A caveat stated is worth more than a claim assumed.

Tick only boxes you genuinely confirmed. Append a dated Log entry with real
paths and real numbers, including any place an earlier estimate turned out
wrong — the correction is useful information, so record it rather than quietly
editing the estimate away.

**The Log you write is the only thing the next session inherits. Write it for
someone with zero context.**

## When blocked

Write in the Log what you tried and what decision is needed, set `Blocked` on
the spec (and in `PROGRESS.md` under `spec-run`), and stop. Do not guess your way past a real
decision.

## Project-specific rules

- **Shopify specifics come from `docs/research/stack.md`**, not memory: React Router 7 template (not
  Remix), Polaris **web components** (`<s-page>`, `<s-button>` …; `@shopify/polaris` React is deprecated),
  Prisma pinned to 6.19.x, Node ≥ 22.12, nested cart lines via `parent_id` on `/cart/add.js`.
- **Every Shopify-facing behaviour you cannot exercise without a store is a `[requires: Shopify dev
  store]` box** — leave it open with a reason; never fake a webhook payload and call it real.
- **Never put prescription values in logs, errors, URLs or job payloads** (INV-2). When debugging, log ids.
- **Installs on this machine:** if you install a system-level tool (e.g. a Postgres Docker image for
  `TEST_DATABASE_URL`), follow `~/.claude/CLAUDE.md` — large data under `/mnt/new-volume/system-data`, and
  update `~/Documents/command-center` in the same session.

## Review checklist — flag these

- Business logic in a route `loader`/`action`; a service importing `react-router`.
- A repository query without `shopId` in its `where` (INV-1).
- `process.env` outside `app/shared/config.server.ts`; a client constructed at import time.
- `useEffect` computing derived state that could be a plain expression or `useMemo` (configurator).
- A hand-rolled loading/error flag in a store where a loader already provides it (admin).
- `any` at an API boundary; an unchecked `as` cast on request or webhook data.
- Floats for money or diopters (INV-4, INV-5); `toFixed` anywhere outside rx-core's formatter.
- Raw colour/size/duration in `packages/configurator` outside `tokens.css` (INV-7); custom CSS in admin routes.
- Inline JSX strings in the configurator (INV-9).
- Work done inside a webhook request that belongs in a job (INV-8).
- An abstraction written before its second concrete use.
