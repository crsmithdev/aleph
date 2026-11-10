---
name: one-way
description: >
  One way: find each concept that code or docs do in more than one place, and
  stop a change from adding a second way. Use when asked to hunt duplicate
  paths, drift or divergence (retro), before you add a function, module,
  parser, constant, route or doc section (check), or when the one-way Stop
  hook blocks.
---

# One way

PRINCIPLES rule 5: one way to do each thing. A **concept** is one job or one fact: a lock, a status verdict,
the parse of a query parameter, a threshold, the end of a run, the meaning of a field. A **copy** is a place
that does that job or states that fact. A concept with two copies **drifts**: a fix lands in one copy, and
the other copy stays wrong. The **owner** is the one copy that stays; the others call it or go.

| Mode | Runs | Reach for it |
|---|---|---|
| `retro` (default) | invoked, over a scope | Find the concepts that already drift |
| `check` | invoked, over a plan, spec or diff | Before or during a build, so the change adds no copy |
| hook | every Stop, with no model | Catch a change that leaves a companion behind or copies an owner |

Read `PRINCIPLES.md`, `docs/naming.md` and any `GLOSSARY.md` first: they name owners that exist. Read
`.one-way.json` at the repo root when it exists: its `accepted` list holds second ways kept on purpose, each
`{"concept", "copies": ["file[:line]", ...], "reason"}`. An accepted concept is reported as accepted, not as a
finding.

## The hold

Two files in the repo keep a concept in one place after it is consolidated:

- `.jscpd.json` `boundaries`: one rule per owner, `{"name", "code": [owner files], "notIn": ["**"], "allow":
  [owner files, "**/*.test.ts"], "disable": ["semantic"]}`. jscpd fails a copy of the owner's code anywhere
  else, edited copies included. Use it when the concept is code.
- A regex lint, in the style of `tests/clock-lint.test.ts`, when the concept is a literal, an env name or a
  query parameter: jscpd does not see a copy that small.

## The hook

`hook.ts` runs at each Stop on the change since the branch left the default branch, plus the working tree:

Both jscpd checks are one run of `clones.ts`, with the repo's `.jscpd.json` (no file, no jscpd checks).

- **co-change**: `cochange.ts` reads the last 2000 commits that are not merges, skips commits of more than
  30 files and test files, and makes a rule A → B when n(A) ≥ 10 and the Wilson lower bound of co(A,B)/n(A)
  is ≥ 0.6. A changed A whose companion B (≥ 0.7) is left out is a finding, with the commits as evidence.
- **boundaries**: a changed file that holds a copy of code a `.jscpd.json` boundary protects.
- **new copies**: a changed file that holds a copy of code, renamed copies included, that the branch's base
  did not have. jscpd compares the tree with the base (`--baseline-from-ref`), so copies already on main do
  not block.

It blocks once per session for one set of findings and never blocks a stop a hook already continued. When it
blocks, do one of three things for each finding: change the companion, call the owner, or add the pair to
`.one-way.json` `accepted` with its reason.

## Signals

Each signal points at a candidate concept. A candidate becomes a finding only when you open each copy and
read it.

- **Repeated fixes.** Files whose commits read as fixes again and again, and pairs that change together.
  `bun <skill dir>/cochange.ts seed --since 90.days` lists both, plus the copies of code below. Then read the subjects that repeat a noun
  ("verdict", "lock", "scope"). This is the strongest signal: the drift already cost a fix.
- **Copies of code.** The `clones` list of the seed: jscpd's copies, renamed ones included, largest first.
  Most are pasted code; read each for the concept behind it.
- **Same underlying API.** Two places that call the same library, CLI or system API for the same job
  (`Bun.spawn` of one program, one paged HTTP endpoint, `Intl.DateTimeFormat`). Search for the call, not the
  name; check `package.json` for a dependency that already does the job.
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

1. **Scope.** Take the scope the user named. Else run `cochange.ts seed` and take the directories of its
   files and pairs, plus the files changed most in the last 30 days
   (`git log --since=30.days --name-only --format= | sort | uniq -c | sort -rn | head -40`) and `docs/`.
   Done when you have a list of directories and the seed output.
2. **Hunt.** Spawn one Explore subagent per two or three directories, in one message. Give each the
   Signals section verbatim, the scope, and the seed lines for its directories. Each returns candidates as:
   concept, every copy with `file:line`, the signal that found it. Done when each subagent has returned.
3. **Prove.** For each candidate, open every copy. Keep it only when the copies do the same job and either
   disagree today or a change to one would need the same change to the other. Name the disagreement with
   the input that shows it, or the commit that fixed one copy and missed the other. Drop a candidate whose
   copies only look alike, and mark one that `.one-way.json` accepts. Done when each kept finding has its
   proof.
4. **Owner.** For each finding, name the owner by layer: domain code over application code over UI over
   infrastructure, and the server over the client. Within one layer, take the copy with the most callers or
   the module whose name already says the concept. Name what each other copy becomes (a call to the owner,
   or deleted), and the hold: a `.jscpd.json` boundary rule or a lint pattern. Done when every finding has an
   owner and a hold.
5. **Report.** Write the HTML report that [REPORT.md](REPORT.md) describes, strongest finding first, with
   the accepted and dropped candidates at the end. Give the user its absolute path and stop. File issues
   only when the user asks. Done when each finding from step 4 has its card.

[EXAMPLES.md](EXAMPLES.md) holds proven findings from earlier reviews: read it before step 3 to calibrate
what a finding, its proof and its owner look like.

## Check

1. **List the new things.** From the plan, spec or diff, list each new function, module, type, parser,
   constant, literal, route, CLI flag, record field, dependency and doc section. Done when each item is on
   the list.
2. **Search for the owner.** For each item, search by its name, two synonyms of its verb, its literals and
   regexes, its inputs and outputs, and the library or API calls it makes. Read each hit that could do the
   same job. Done when each item has its searches and hit counts.
3. **Judge.** Each item gets one verdict:
   - **new**: no existing path does the job.
   - **reuse**: a path does the job. Name it; the change calls it.
   - **extend**: a path does most of the job. Name it; the change deepens it.
   - **second way**: the change adds a copy on purpose. Add it to `.one-way.json` `accepted` with the
     reason the existing path cannot serve.

   Done when every item has a verdict with `file:line` or its search record.
4. **Consolidations.** When the change makes one copy the owner of a concept, add its hold in the same
   change: a `.jscpd.json` boundary rule, or a lint for a literal. Done when each consolidation has a hold.
