# Refit process

The process of the six refit skills. A refit skill supplies its lens files, its find step, its Act order, its
report unit and its guards. Its SKILL.md says only what differs from this file.

Read `PRINCIPLES.md`, the [glossary](../domain-modeling/SKILL.md) and `docs/adr/` first when they exist: they name
owners and settled decisions. Read `.refit.json` at the repo root when it exists. Its `accepted` list holds what
the repo keeps on purpose, each `{"concept", "copies": ["file[:line]", ...], "reason"}`. An accepted candidate is
reported as accepted, not as a finding.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `scan [scope]` (default: all lenses) | Baseline, find, prove, write the findings, report, pick | Find what to improve, change nothing |
| `fix [scope]` | The scan, then the Act loop on each auto finding before the report | Find what to improve and fix what needs no question |
| `fix <run dir>` | The Act loop on the picked findings of a saved run | A later session, after the user picks |

The scope is a list of lens names, unless the skill names another scope. Checking new work is not a mode: each
writer skill checks its own diff against its `RULES.md`, by [write/PROCESS.md](../write/PROCESS.md).

## Steps

1. **Baseline.** Run the repo's own build, test and lint commands from its manifest. A red baseline ends the run.
   Record the commit and `git status --porcelain`. Done when the baseline is green and recorded.
2. **Find.** Run the skill's find step (its SKILL.md), then hunt: spawn one Explore subagent per lens in one
   message. Give each its lens file's Signals section verbatim, the scope, and the find step's output for its
   scope. A lens that the skill reads from a tool gets no subagent. Each returns candidates as: lens, concept or
   unit, every location with `file:line`, the signal that found it. Done when each subagent has returned.
3. **Prove and tier.** Follow [PROVE.md](PROVE.md). Done when each candidate has a verdict, and each finding an
   owner, a guard and a tier.
4. **Write the findings.** Write the run directory of [FINDINGS.md](FINDINGS.md). Done when `findings.json` holds
   every candidate.
5. **Fix** (`fix` mode only). Run the Act loop on each auto finding, with no question first. Done when each auto
   finding has the status `fixed` or `reverted`.
6. **Report and pick.** Draw the report of [REPORT.md](REPORT.md) from `findings.json`, then let the user pick, by
   PROVE.md's Pick. Done when the report is written and the picked findings are fixed, or none waits.

## Act loop

For each finding, in the skill's Act order:

1. Make the lens's fix. Delete or change the whole thing: the code, its tests, fixtures, exports, docs entry and
   dependency line. Edit only the lines the finding names, its riders and what the user named. Report the rest.
2. Add the finding's guard when its tool exists in the repo.
3. Run the baseline commands, and the skill's own checks after each finding. Green: commit, naming the lens and
   the finding, and set the status `fixed` with the commit. Red: revert that finding, and set the status
   `reverted` with the failed command and the proof step that missed. Never carry a red build into the next
   finding.

During the loop, an item in a touched file, or in a file the finding names, that one of the skill's lenses
covers is a **rider**. An auto rider is a finding of its own, with its own commit, marked "found during fix". An
ask rider joins the ask findings. An item that no lens of the skill covers goes to `aleph issue add`, never into
the findings.

## Fix a saved run

`fix <run dir>`:

1. Read `findings.json` from the run directory. Take each finding with the status `picked`. With none picked,
   run PROVE.md's Pick first.
2. Run the baseline.
3. Open each location of each picked finding at HEAD, and apply its lens's proof bar again. A finding that no
   longer holds gets the status `stale`, with the reason.
4. Run the Act loop on the rest, in the skill's Act order.
5. Draw the report again from the file. Done when each picked finding is `fixed`, `reverted` or `stale`.

## Lens files

Each lens file has these sections, in this order:

- **Signals:** what finds a candidate. The hunt subagent gets this section verbatim.
- **Proof:** the bar a candidate meets to be a finding.
- **Fix:** what changes, and who owns the result.
- **Guard:** what keeps the fix from coming back.

The lens file opens with its question. The paired writer's `RULES.md` tags each rule with the lens that finds a
break of it.

## Guards

A guard keeps a fixed finding fixed. Each guard has a kind: **tool** (a hook, a test or CI runs it), **rule** (the
writer's `RULES.md` states it, so the writer checks it) or **unchecked** (only a refit finds it). A finding that
comes back moves up: unchecked, then rule, then tool.

## Red flags

- **You loosened a proof bar to keep a finding.** The finding goes. The bar stays.
- **A change "should be safe".** A green baseline proves it, or it is not done.
