# One-way lens

PRINCIPLES rule 5: one way to do each thing. A **concept** is one job or one fact: a lock, a status verdict,
the parse of a query parameter, a threshold, the end of a run, the meaning of a field. A **copy** is a place
that does that job or states that fact. A concept with two copies **drifts**: a fix lands in one copy, and the
other copy stays wrong. The **owner** is the one copy that stays; the others call it or go.

## Signals

- **Repeated fixes.** Files whose commits read as fixes again and again, and pairs that change together:
  `cochange.ts seed`. Then read the subjects that repeat a noun ("verdict", "lock", "scope"). This is the
  strongest signal: the drift already cost a fix.
- **Copies of code.** The seed's `clones` list: jscpd's copies, renamed ones included, largest first. Most are
  pasted code; read each for the concept behind it.
- **Same underlying API.** Two places that call the same library, CLI or system API for the same job
  (`Bun.spawn` of one program, one paged HTTP endpoint, `Intl.DateTimeFormat`). Search for the call, not the
  name; check `package.json` for a dependency that already does the job.
- **Twin literals.** The same magic number, regex, path, status string, env name or SQL fragment in two
  modules (`grep -rn` the literal, excluding tests and `node_modules`).
- **Twin parsers.** Two places that turn the same input into a value: a query parameter, a frontmatter field,
  a date, an ID, a CLI flag.
- **Twin writers.** Two places that write the same record, file or field. The reader then cannot know which
  rule produced it.
- **Synonym functions.** Two functions with the same job under different names (`lock`/`claim`,
  `verdict`/`statusOf`). Search by the verb and its synonyms, and by the callers.
- **Recomputed state.** A value that one module computes and another recomputes from raw data instead of
  asking the first.
- **Client and server copies.** One rule written once in `ui/` and once on the server.
- **Doc copies.** One concept described in two docs, or a doc that states a rule the owner in code does not
  follow. The code is the truth; the doc is the copy.

## Proof

Keep a candidate only when the copies do the same job and either disagree today or a change to one would need
the same change to the other. Name the disagreement with the input that shows it (one input, two results), or
the commit that fixed one copy and missed the other. Copies that only look alike are dropped.

## Fix

Name the owner by layer: domain code over application code over UI over infrastructure, and the server over
the client. Within one layer, the copy with the most callers or the module whose name already says the concept.
Each other copy becomes a call to the owner, or goes. A doc copy names the owner (file and symbol) instead of
restating its values.

## Hold

- Code: a `.jscpd.json` boundary rule for the owner, `{"name", "code": [owner files], "notIn": ["**"], "allow":
  [owner files, "**/*.test.ts"], "disable": ["semantic"]}`. jscpd fails a copy of the owner's code anywhere
  else, edited copies included.
- A literal, env name or query parameter: a lint test in the style of `tests/clock-lint.test.ts`, since jscpd
  does not see a copy that small.

## Check

Does a path already do this job? Search by the item's name, two synonyms of its verb, its literals and
regexes, its inputs and outputs, and the library or API calls it makes. Read each hit that could do the same
job.

## The hook's checks

- **co-change**: `cochange.ts` reads the last 2000 commits that are not merges, skips commits of more than 30
  files and test files, and makes a rule A → B when n(A) ≥ 10 and the Wilson lower bound of co(A,B)/n(A) is
  ≥ 0.6. A changed A whose companion B (≥ 0.7) is left out is a finding, with the commits as evidence.
- **boundaries**: a changed file that holds a copy of code a `.jscpd.json` boundary protects.
- **new copies**: a changed file that holds a copy of code, renamed copies included, that the branch's base did
  not have. jscpd compares the tree with the base (`--baseline-from-ref`), so copies already on main do not
  block.

Both jscpd checks are one run of `clones.ts`, with the repo's `.jscpd.json` (no file, no jscpd checks).
