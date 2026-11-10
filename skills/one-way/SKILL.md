---
name: one-way
description: >
  One way: find each concept that code or docs do in more than one place, and
  stop a change from adding a second way. Use when asked to hunt duplicate
  paths, drift or divergence (retro), or before you add a function, module,
  parser, constant, route or doc section (check).
---

# One way

PRINCIPLES rule 5: one way to do each thing. A **concept** is one job or one fact: a lock, a status verdict,
the parse of a query parameter, a threshold, the end of a run, the meaning of a field. A **copy** is a place
that does that job or states that fact. A concept with two copies **drifts**: a fix lands in one copy, and
the other copy stays wrong. The **owner** is the one copy that stays; the others call it or go.

| Mode | Input | Reach for it |
|---|---|---|
| `retro` (default) | a scope in the repo | Find the concepts that already drift |
| `check` | a plan, a spec or a diff | Before or during a build, so the change adds no copy |

Read `PRINCIPLES.md`, `docs/naming.md` and any `GLOSSARY.md` first: they name owners that exist.

## Signals

Each signal points at a candidate concept. A candidate becomes a finding only when you open each copy and
read it.

- **Repeated fixes.** Two or more commits that fix the same behaviour in different files
  (`git log --since=<n> --name-only`, then read the subjects that repeat a noun: "verdict", "lock", "scope").
  This is the strongest signal: the drift already cost a fix.
- **Twin literals.** The same magic number, regex, path, status string, env name or SQL fragment in two
  modules (`grep -rn` the literal, excluding tests and `node_modules`).
- **Twin parsers.** Two places that turn the same input into a value: a query parameter, a frontmatter
  field, a date, an ID, a CLI flag.
- **Twin writers.** Two places that write the same record, file or field. The reader then cannot know which
  rule produced it.
- **Synonym functions.** Two functions with the same job under different names (`lock`/`claim`,
  `verdict`/`statusOf`). Search by the verb and its synonyms, and by the callers.
- **Recomputed state.** A value that one module computes and another recomputes from raw data instead of
  asking the first.
- **Client and server copies.** One rule written once in `ui/` and once on the server.
- **Doc copies.** One concept described in two docs, or a doc that states a rule the owner in code does not
  follow. The code is the truth; the doc is the copy.

## Retro

1. **Scope.** Take the scope the user named. Else take the files changed most in the last 30 days
   (`git log --since=30.days --name-only --format= | sort | uniq -c | sort -rn | head -40`) plus `docs/`.
   Done when you have a list of directories.
2. **Hunt.** Spawn one Explore subagent per two or three directories, in one message. Give each the
   Signals section verbatim and the scope. Each returns candidates as: concept, every copy with `file:line`,
   the signal that found it. Done when each subagent has returned.
3. **Prove.** For each candidate, open every copy. Keep it only when the copies do the same job and either
   disagree today or a change to one would need the same change to the other. Name the disagreement with
   the input that shows it, or the commit that fixed one copy and missed the other. Drop a candidate whose
   copies only look alike. Done when each kept finding has its proof.
4. **Owner.** For each finding, name the owner: the copy with the most callers, or the module whose name
   already says the concept. Name what each other copy becomes (a call to the owner, or deleted), and a
   pattern that a lint could ban outside the owner. Done when every finding has an owner and a pattern.
5. **Report.** Write the HTML report that [REPORT.md](REPORT.md) describes, strongest finding first, with
   the dropped candidates at the end. Give the user its absolute path and stop. File issues only when the
   user asks. Done when each finding from step 4 has its card.

[EXAMPLES.md](EXAMPLES.md) holds proven findings from earlier reviews: read it before step 3 to calibrate
what a finding, its proof and its owner look like.

## Check

1. **List the new things.** From the plan, spec or diff, list each new function, module, type, parser,
   constant, literal, route, CLI flag, record field and doc section. Done when each item is on the list.
2. **Search for the owner.** For each item, search by its name, two synonyms of its verb, its literals and
   regexes, and its inputs and outputs. Read each hit that could do the same job. Done when each item has
   its searches and hit counts.
3. **Judge.** Each item gets one verdict:
   - **new**: no existing path does the job.
   - **reuse**: a path does the job. Name it; the change calls it.
   - **extend**: a path does most of the job. Name it; the change deepens it.
   - **second way**: the change adds a copy on purpose. Record why the existing path cannot serve.

   Done when every item has a verdict with `file:line` or its search record.
4. **Consolidations.** When the change makes one copy the owner of a concept, name the pattern that a lint
   could ban outside the owner, so the concept stays in one place. Done when each consolidation has one.
