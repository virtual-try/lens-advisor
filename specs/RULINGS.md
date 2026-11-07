# Review rulings

Read this **before** reviewing any spec. It does two things: it calibrates
severity, and it records points the lead has already ruled on, so they are not
raised again.

## Severity

| Severity | Means | Examples |
| --- | --- | --- |
| **BLOCKER** | Must not merge. Wrong behaviour, data loss, a security or privacy hole, a broken invariant (`INVARIANTS.md`), or a ticked `Done when` box with no proof | A private item in a search result · a test that passes with the code deleted · a user edit overwritten |
| **MAJOR** | Fix before merge, but the behaviour is not wrong today | A missing error state · a stub in production code that is not reachable yet · an `Examples` row with no test |
| **MINOR** | Worth fixing, never blocks | Naming · comment wording · a helper that could be shared · test layout |

A finding that is only a preference is MINOR. A finding without a path and a
line is not a finding. When unsure between two levels, pick the lower one and
say why.

## Rulings

Append-only. One row per ruling. A reviewer does not raise a ruled-out point
again unless the code it rested on has changed — then say what changed.

| # | Date | Spec | Finding | Ruling | Reason |
| --- | --- | --- | --- | --- | --- |

