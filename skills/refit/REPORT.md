# Report

The report of a refit run, drawn from its `findings.json` ([FINDINGS.md](FINDINGS.md)). All six refit skills write
this shape. A skill names its unit and its Overview additions in its own SKILL.md. refit-design adds the rules in its
[REPORT.md](../refit-design/REPORT.md). [HTML.md](HTML.md) has the markup, the figure and the tone.

## Directory

The run directory of FINDINGS.md holds the report:

- `index.html`: the report.
- `app.css`: a copy of `ui/app.css` from the scanned commit (`git show <commit>:ui/app.css`), so the report keeps its
  look when the CSS changes. If the repo has no `ui/app.css`, copy the one of the aleph repo.
- `report.css`: a copy of [report.css](report.css).
- Other files the report needs, such as screenshots. Link each with a relative path.

## Parts

Five cards, in this order. Each is a `<section class="card">`, so no card sits in a card. [example.html](example.html)
shows each part.

1. **Overview.** No part said twice:
   - **Repo line.** The commit scanned, the date, the mode and the baseline, as one `.facts` line.
   - **Counts.** Three tiles, each a link to its card: the ask findings, the auto findings and the dropped
     candidates. A `fix` run adds a fourth, the findings fixed. A skill with tier `none` shows the findings and the
     dropped candidates.
   - **Fold.** One closed `<details>` holds the rest: the findings per lens, then the skill's own additions (its
     SKILL.md names them), such as refit-code's seed and sweep. An addition that its SKILL.md says opens the
     Overview sits above the tiles instead.
   - **Links.** The page head links back to the shelf, at the shelf's base URL (the output of `shelf url`) plus
     `/shelf/`. The repo line links each mock the run made, by the URL that `shelf put` printed for it, so put a
     mock on the shelf before the report.
2. **Ask.** The ask findings, each open. The card lede says what an ask fix changes, and the figure key follows
   it. Omit the card when no finding is ask.
3. **Auto.** The auto findings, each one closed row that opens to its card. A `fix` run marks each row with its
   result. The card ends with one line that names the units with no finding: "No findings: ...". A skill with tier
   `none` has one card, Findings, in place of Ask and Auto, with each finding open.
4. **Dropped.** One closed `<details>`, its summary "Dropped: N". It holds one table of the candidates that are
   not findings, with the columns #, Candidate, Verdict and Lens: dropped, accepted, and for the dead lens a
   survivor. The reason sits under the title in `<small>`.
5. **Proposals.** Each change to the skill's reference doc that the run asks for: where, the evidence and the
   sentence the doc needs. Omit the part when there are none. The skill changes no doc text.

In Ask, Auto and Findings, the findings sit in groups, one `.group` per lens, in the order of the skill's lens table,
and strongest first in a group. The group head names the lens and its count. The SKILL.md of each skill names its
unit, which each row shows: refit-code a module, refit-docs a doc page, refit-tests a test file, refit-agents a
loaded file (CLAUDE.md, skill or hook), refit-data a shown number, refit-design a component kind.

## Finding card

One finding per `id="f<n>"`, with `data-annotate="f<n>"`, `n` from `findings.json`. The card shows no proof line:
the hunt proves a finding, and the report does not repeat it. A finding that touches more than one unit shows the
unit of its owner, and its locations name the others. The card holds, in this order:

1. **Row**: the number, the title, the unit, then the strength and the signal. The title is the change, as an
   imperative ("Parse issue refs in one place"). The strength is the lens's: one-way `Disagrees` or
   `Duplicates`; dead its tier; depth, seams, slop and layout their 1-5 rating or "proven"; waste
   "measured".
2. **Ask line**, for an ask finding: the `ask` badge and the PROVE.md trigger, in one sentence. A `fix` run shows an
   auto finding's result here: its commit hash, "reverted" with the failed command, or "found during fix" for a
   rider.
3. **Fix**: one sentence from the lens's Fix section. When a shared helper makes the fault, such as a fetch that
   writes the error line, the fix changes the helper, and every caller gets it. Mark a finding that needs
   [DEEPEN.md](../refit-code/DEEPEN.md).
4. **Before / after**: by the finding's `figure` field. With `figure` true (the fix changes how two or more files
   relate: it merges copies, moves an owner, closes a leak or collapses a call path), one figure of
   [HTML.md](HTML.md): panels "Before" and "After", with the copies, the shallow cluster or the crossing reads
   before, red dashed edges for disagreements and leaks, and after the owner or deep module as the one dark box,
   the former copies as grey callers. With `figure` false (a finding in one file), `before` and `after` in one
   diff panel. A layout finding shows the before and after file tree in the diff panel.
5. **Locations, guard**: one closed `<details>` that holds the rest:
   - **Locations**: a list, one `file:line` each, the owner first and marked.
   - **Guard**: the boundary rule as JSON in `<pre>`, or the lint pattern or tool rule in `<code>`, or "model:
     check" where no tool guards it.
   - **History**: the commits that already fixed drift here, when the git log shows them.
   - **ADR**: one amber line when the finding contradicts an ADR, with why it is worth reopening.
