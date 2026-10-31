# Factory tasks

This table states what starts each factory task, what it does and what stops two runs from doing the same work. Read as of 2026-10-31 from `jobs/cli.ts` and `jobs/lib/`. A new task adds a row with all five answers.

| Task | Trigger | Does | Triggers next | Human re-enters | Stops duplicate work |
|---|---|---|---|---|---|
| Triage | Tick; an open issue with no goal | Read-only run gives one verdict | Goal, close, done or Ask | Ask, or 2 runs with no verdict | Lock `triage-<issue>` |
| Plan | Dispatch; `needsPlan` says the goal is large | Read-only run splits it into 2-6 goals | The child goals | Goal runs as one worker after 2 bad replies | Lock `plan-<repo>-<id>` |
| Build | Dispatch; a ready goal under the caps | Worker, checks, then review | Land, or a fix round | Ask after the fix rounds | Lock `goal-<name>`; the status is read again under it |
| Review | Inside a build, after the checks | Reviewer reads the diff cold | Pass, or a send-back | Ask on a second no verdict | One per build, in the unit |
| Land | A build passes, or `aleph land` | Merges main, checks, pushes | Facts, acceptance | Conflict that a rework cannot clear | Lock `land-start-<repo>-<name>` |
| Facts | Dispatch; a landed job with no facts marker | Keeps checked notes in the vault | Nothing | None | Lock `facts-<name>`; the marker is read again under it |
| Acceptance | Dispatch; a done goal with no final result | Reruns the Oracle on main | Flake note, reopen or Ask | Ask on a second real failure | Lock per goal; a pass is reused per commit and command |
| Firefighter | Tick; a new event in the snapshot | Read-only run; code checks and applies its actions | The action taken | Its `tell` and Ask actions | `firefighter.json` keeps the event keys it saw |
| Corrections | Tick; once a day from 03:00 local | Groups signals into lessons and proposes a check, a rule or a skill | A proposal | Approve or decline | Signal ids already in a lesson are skipped |
| Episodes | Tick; a finished goal | Writes its episode page | Nothing | None | `episodes-seen` |
| Dependency sweep | Tick; after the probe passes | `bun outdated` in a fresh clone | An issue with an approval Ask | Approve or decline | `deps.json` records `<repo>:<package>@<version>` |

## Ticket sources

| Source | Files | Stops the same ticket twice |
|---|---|---|
| Worker `FOLLOWUP:` line | An issue with source `worker` | `sameTopic` against open issues; a match is a note. Triage has its own duplicate check after that |
| Worker `FLAKE:` line, acceptance | A note on the flake tracker, no issue | One open tracker per repo |
| Dependency sweep | One issue per package and version | `deps.json` |
| Corrections | A proposal per lesson | Lesson state |

## Known gaps

- Acceptance keeps passes for the latest commit only. Main moves with each land, so goals accepted on different commits still run the suite again.
- The review of a build has no lock of its own. It relies on the build's lock and the one-unit-per-job rule.
