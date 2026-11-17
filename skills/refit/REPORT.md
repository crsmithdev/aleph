# Report

The report of a refit run, drawn from its `findings.json` ([FINDINGS.md](FINDINGS.md)). All six refit skills write
this shape. A skill names its unit and its Overview additions in its own SKILL.md. refit-design adds the rules in its
[REPORT.md](../refit-design/REPORT.md). [HTML.md](HTML.md) has the scaffold, the figure and the tone.

## Directory

The run directory of FINDINGS.md holds the report:

- `index.html`: the report.
- `app.css`: a copy of `ui/app.css` from the scanned commit (`git show <commit>:ui/app.css`), so the report keeps its
  look when the CSS changes. If the repo has no `ui/app.css`, use a small inline `<style>` and the same class names.
- Other files the report needs, such as screenshots. Link each with a relative path.

## Parts

Four parts, in this order. Each is a `<section class="card">`, so `.card` rules apply and no card sits in a card:
a variant is an `<h3 class="sub-head">`, not a card.

1. **Overview.** One card, with no part said twice:
   - **Repo line.** Repo name, date, the commit scanned, the scope and the lenses run, as one `.facts` line. A
     skill's own additions follow (see its SKILL.md). refit-code adds a legend of the figure's classes (`.node` box = module or copy, `.own` dark box = owner or
     deep module, `.gone` grey dashed box = caller or removed copy, `.leak` red dashed line = disagreement or leak)
     and a seed line: the top files, pairs and copies that `cochange.ts seed` gave.
   - **Counts.** Two counts after the repo line: the findings fixed, with the commit hash of each, and the findings
     waiting for Chris (the ask findings). A `scan` run fixes none.
   - **Links.** The page head links back to the shelf, at the shelf's base URL (the first line of
     `~/.local/share/aleph-tools/shelf/url`) plus `/shelf/`. The repo line links each mock the run made, by the URL that
     `shelf.ts put` printed for it, so put a mock on the shelf before the report.
   - No themes and no baseline line: the units carry the order, and a red baseline ends the run before a report.
2. **Units.** One section per unit the skill scanned, in the find order, with `data-annotate="<unit id>"`. A unit
   with findings shows one finding card each. A unit with no finding is one line: "No issues." The SKILL.md of
   each skill names its unit: refit-code a module, refit-docs a doc page, refit-tests a test file, refit-agents a
   loaded file (CLAUDE.md, skill or hook), refit-data a shown number, refit-design a component kind.
3. **Findings.** One card at the bottom, above Proposals, with one closed `<details>`, its
   summary "Findings: N, and M dropped". It holds one table of every candidate, with the columns #, Finding, Kind and
   Lens. A finding row links its title to its card. The findings come first, grouped by kind. The rows that are not
   findings come last in `tr.quiet`: dropped, accepted, and for the dead lens a survivor. Their Kind cell is the
   verdict, and the reason sits under the title in `<small>`.
4. **Proposals.** Each change to the skill's reference doc that the run asks for: where, the evidence and the
   sentence the doc needs. Omit the part when there are none. The skill changes no doc text.

## Finding card

One `<div data-annotate="f<n>">` per finding, inside its unit, strongest first, with `n` counting from 1 over the
report. The card shows no proof line: the hunt proves a finding, and the report does not repeat it. A finding that touches more than one unit sits in the unit of its owner and names the others in its
locations. The card holds, in this order:

1. **Title**: the change, as an imperative ("Parse issue refs in one place"). The badge row follows it: the lens,
   then its strength: one-way `Disagrees` (red) or `Duplicates` (amber); dead its tier; depth, seams, slop and
   layout their 1-5 rating or "proven". Then the signal that found it.
2. **Tier and result**: **auto** or **ask**, as PROVE.md's step 2 gives it, with one sentence that names the
   trigger of an ask finding. An auto finding then shows its commit hash, "reverted" with the failed command, or
   "found during fix" for a rider. A `scan` run shows the tier alone.
3. **Fix**: one sentence from the lens's Fix section. When a shared helper makes the fault, such as a fetch that
   writes the error line, the fix changes the helper, and every caller gets it. Mark a
   finding that needs [DEEPEN.md](../refit-code/DEEPEN.md).
4. **Before / after**: by the finding's `figure` field. With `figure` true (the fix changes how two or more files
   relate: it merges copies, moves an owner, closes a leak or collapses a call path), one figure of
   [HTML.md](HTML.md): panels "Before" and "After", with the copies, the shallow cluster or the crossing reads
   before, red dashed edges for disagreements and leaks, and after the owner or deep module as the one dark box,
   the former copies as grey callers. With `figure` false (a finding in one file), the lines or text before and
   after in a `<pre>`, and no figure. A layout finding shows the before and after file tree as text.
5. **Details**: one closed `<details>`, summary "Details", that holds the rest:
   - **Locations**: a list, one `file:line` each, the owner first and marked.
   - **Guard**: the boundary rule as JSON in `<pre>`, or the lint pattern or tool rule in `<code>`, or "model:
     check" where no tool guards it.
   - **History**: the commits that already fixed drift here, when the git log shows them.
   - **ADR**: one amber line when the finding contradicts an ADR, with why it is worth reopening.
