---
name: prior-art
description: >
  Survey the open-source projects that solve the same problem as a repo you
  own, compare their architecture against it, and return a ranked list of
  what to take and what to skip. Derives the comparison axes from the anchor
  repo's own design, scans wide over READMEs to pick finalists, then clones
  the finalists and reads their code with file:line citations. Use when the
  user asks what else is out there, how their project compares to similar
  ones, what other people built for this, or what to steal from them.
  Triggers on: "research similar projects", "prior art", "what else solves
  this", "how does X compare to other", "survey the field", "/prior-art".
  NOT for: market, pricing or positioning research; reviewing one repo with
  no anchor to compare it to; stress-testing a plan (use /aleph:red-team).
---

# Prior Art

Read the field against a repo you own, and come back with a ranked list of
what to take.

The output is not a landscape. A landscape names who exists; this names what
changes in the **anchor**. Every finding is relative to one repo, and every
recommendation is costed.

## Vocabulary

| Term | Means |
|---|---|
| **anchor** | The repo the survey is for. Every axis and every take is relative to it. |
| **axis** | One load-bearing decision the anchor made that another project could have made differently. The comparison's columns. |
| **finalist** | A candidate promoted out of the wide scan and read at the code level. |
| **take** | Something worth porting into the anchor, with a cost. |
| **skip** | Something the field does that the anchor should not do, with the reason. |

## Procedure

### 1. Fix the anchor

Establish which repo the survey is for before searching. If the user named
one, use it; if the session is inside a repo and they said "this", use that;
otherwise ask, and do not guess.

Then read it. Not the README: the code that implements the thing being
compared, plus any spec or decision record under `docs/`. You need its real
architecture, because the axes come from it and because a take you propose
may already be built.

Two sources earn a specific look, because they are where the sharpest
recommendations come from:

- **The problem statement** of any spec. It names failures that already
  happened. A take that answers one of those outranks every take that
  answers a hypothetical.
- **`git log` for reverts and reversals.** `git log --oneline --grep=revert
  -i` and the commits around them. A revert is a failure the anchor paid
  for. Find what the field does about that class of failure.

Also note what the anchor's own docs rule out: a threat model, a scope
boundary, a stated non-goal. Anything the field does that those exclude is
a **skip**, not a take, and saying so is part of the deliverable.

Completion criterion: you can state the anchor's problem, its architecture
in one paragraph, and at least one failure it has already had.

### 2. Derive the axes

Write the axes down before searching. Axes derived after reading the field
describe the field; axes derived from the anchor measure it.

Four to eight. Each is a decision the anchor made, phrased so that any
project in the field has an answer to it, including "none". Prefer the
decisions that would be expensive to change.

Good axes are mechanical: where state lives, how work is dispatched, what
isolates one unit of work from another, what gates the irreversible step,
what happens on crash, what bounds the cost. Bad axes are adjectival: "ease
of use", "maturity", "philosophy".

Show the user the axis list before the scan. It is the cheapest moment to
correct the survey's shape.

### 3. Scan wide

**Find the curated list first.** For most fields one already exists
(`awesome-<topic>`), and one of them is worth more than ten searches: it
gives the field's own taxonomy, the long tail, and the projects too small to
rank in search. Fetch its raw markdown rather than the rendered page, so you
get every entry and its URL.

Then search for what the list misses: the field's vocabulary changes, so run
the anchor's own terms and the field's terms separately.

This phase is READMEs and docs only. No cloning. Build a candidate table:
name, one line, apparent group, and why it is or is not a finalist.

Report the shape of the field before the finalists: how the projects group,
and which group the anchor sits in. If the anchor spans groups, say so —
that is usually why nothing matches it whole.

Promote six to ten **finalists**: the ones closest on the axes, plus any
outlier that answers an axis in a way nobody else does. Show the user the
candidate table and the promotions, and take their corrections.

### 4. Read the finalists' code

Dispatch subagents, two to three finalists each, in one message.

Every subagent prompt carries: the anchor's name and one-paragraph
architecture, the axis list, its finalists' URLs, and the evidence rules
below. Use `subagent_type: "general-purpose"`, in the foreground.

Each subagent returns, per finalist:

1. The value on every axis, or "none".
2. Anything it does that the anchor has no answer for.
3. Anything the anchor does better, stated plainly.
4. Reported numbers from the project's own docs, labelled as theirs.

**Evidence rules**, in every subagent prompt and in your own synthesis:

- Clone to a durable directory (`~/.aleph/prior-art/<anchor>/<project>`),
  and pull instead of re-cloning on a later run.
- Cite `file:line` for every claim about how something works.
- A claim from a README is a claim about what the project says, and is
  labelled as one. A claim about behaviour comes from code or it is marked
  unverified.
- Separate the judgment from the fact. "Stores state in Postgres
  (`db/schema.sql:1`)" is a fact; "heavier than the anchor needs" is a
  judgment, and it belongs in your synthesis, not in the evidence.
- Record the commit each finalist was read at. The survey is a snapshot and
  says so.

### 5. Rank the takes

The matrix comes first: finalists as rows, axes as columns, the anchor as
the first row. This is the artifact's centrepiece, so fill every cell.

Then three sections, in this order:

**Where the anchor is already unusual.** Before what to change, what not to.
This is what the survey protects, and it is the section most likely to be
skipped; write it.

**What to take**, ranked by value over cost. Each take names the project it
comes from, what changes in the anchor, an estimate in agent time, and the
evidence. Lead with any take that answers a failure the anchor already had
and name that failure. Where a project publishes a number for the mechanism,
quote it as theirs.

**What to skip**, with the reason each is wrong for this anchor: excluded by
its threat model, disproportionate at its scale, or already solved by
something it has. A survey that only says yes is a wish list.

Then look once more for the uncomfortable finding: something in the field
that makes a part of the anchor redundant. A survey that never proposes a
deletion probably did not read hard enough. Say it if it is there.

### 6. Deliver

Report in the terminal, then publish the survey as an artifact: the matrix,
the three sections, the sources, and a closing note stating what was read at
the code level and what came from a README.

Give the artifact a title naming the comparison, not the topic.

## Calibration

- **The axes are the deliverable's spine.** A survey that compares on the
  field's terms instead of the anchor's produces a feature checklist, which
  is the failure mode of every competitor analysis.
- **Cost every take**, in agent time. An uncosted recommendation cannot be
  ranked, and a ranked list is the whole point.
- **Prefer the mechanism to the feature.** "Runs the evidence test against
  the old commit and requires it to fail" is portable. "Has good verification"
  is not.
- **A project's own numbers are evidence about the mechanism**, not about the
  anchor. Quote them, attribute them, and never restate them as a prediction.
- Do not soften a take because it implies rework, and do not inflate one
  because the project is popular. Stars measure attention.
