# Factory tasks

This table states what starts each factory task, what it does and what stops two runs from doing the same work. Read as of 2026-10-31 from `jobs/cli.ts` and `jobs/lib/`. A new task adds a row with all five answers.

| Task | Trigger | Does | Triggers next | Human re-enters | Stops duplicate work |
|---|---|---|---|---|---|
| Triage | Tick; an open issue with no goal | Read-only run gives one verdict | Goal, close, done or Ask | Ask, or 2 runs with no verdict | Lock `triage-<issue>` |
| Plan | Dispatch; `needsPlan` says the goal is large | Read-only run splits it into 2-6 goals | The child goals | Goal runs as one worker after 2 bad replies | Lock `plan-<repo>-<id>` |
| Build | Dispatch; a ready goal under the caps | Worker, checks, then review | Land, or a fix round | Ask after the fix rounds | Lock `goal-<name>`; the status is read again under it |
| Review | Inside a build, after the checks | Reviewer reads the diff cold | Pass, or a send-back | Ask on a second no verdict | One per build, in the unit |
| Land | A build passes, or `aleph land` | Merges main, checks, pushes | Nothing | Conflict that a rework cannot clear | Lock `land-start-<repo>-<name>` |
| Director | Tick; an Ask with no case text | Read-only run per Ask; code checks and applies its actions, or writes its case text | The action taken, or the Ask to Chris | The escalation list, or an Ask it did not decide | Lock `director-<on>`; an Ask with case text is not taken again |
| Firefighter | Tick; a red baseline, a red CI on main, a failed probe, a land live for 30 minutes | Code: files a critical issue with the log, or sets a rescue Ask | An issue, a note or an Ask | None | The issue's `Failing commit:` line; the land run's `asked` file |
| Corrections | Tick; once a day from 03:00 local | Groups signals into lessons and proposes a check, a rule or a skill | A proposal | Approve or decline | Signal ids already in a lesson are skipped |
| Episodes | Tick; a finished goal | Writes its episode page | Nothing | None | `episodes-seen` |

## Ticket sources

| Source | Files | Stops the same ticket twice |
|---|---|---|
| Worker `FOLLOWUP:` line | An issue with source `worker` | `sameTopic` against open issues; a match is a note. Triage has its own duplicate check after that |
| Worker `FLAKE:` line | A note on the flake tracker, no issue | One open tracker per repo |
| Corrections | A proposal per lesson | Lesson state |

## Known gaps

- The review of a build has no lock of its own. It relies on the build's lock and the one-unit-per-job rule.
