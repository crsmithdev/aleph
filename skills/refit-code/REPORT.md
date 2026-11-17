# Retro report

The report of a refit `retro`. All six refit skills write this shape. A skill adds to the Overview's repo line or names its unit in
its own SKILL.md. refit-design adds the rules in its [REPORT.md](../refit-design/REPORT.md). The sweep reports in
the terminal instead. [HTML.md](HTML.md) has the scaffold, the diagram patterns and the tone.

## Directory

Write `<tmpdir>/refit-<skill>-retro-<timestamp>/`, with `<tmpdir>` from `$TMPDIR`, else `/tmp`:

- `index.html`: the report.
- `app.css`: a copy of `ui/app.css` from the scanned commit (`git show <commit>:ui/app.css`), so the report keeps its
  look when the CSS changes. If the repo has no `ui/app.css`, use a small inline `<style>` and the same class names.
- Other files the report needs, such as screenshots. Link each with a relative path.

## Parts

Three parts, in this order. Each is a `<section class="card">`, so `.card` rules apply and no card sits in a card:
a variant is an `<h3 class="sub-head">`, not a card.

1. **Overview.** One card, with no part said twice (Chris, 2026-11-16):
   - **Repo line.** Repo name, date, the commit scanned, the scope and the lenses run, as one `.facts` line. A
     skill's own additions follow (see its SKILL.md). refit-code adds a legend (box = module or copy, dark box = owner or deep module, red dashed line =
     disagreement or leak, grey box = caller) and a seed line: the top files, pairs and copies that
     `cochange.ts seed` gave.
   - **Themes.** One list item per theme: the theme in bold, then the numbers of its findings, each a link to its
     card. A repeated cause is one theme. No summary sentence comes before it: the themes carry it (Chris,
     2026-11-16). List the themes in the order to act. Rank first by drift or failure that already cost a fix,
     then by how many callers or pages the theme touches, then by the lines it removes. The themes carry this
     order, so the report has no Actions list (Chris, 2026-11-16).
   - **Findings.** One closed `<details>`, its summary "Findings: N, and M dropped" (Chris, 2026-11-16). It holds
     one table of every candidate, with the columns #, Finding, Kind and Lens. A finding row links its
     title to its card. The findings come first, grouped by kind. The rows that are not findings come last in
     `tr.quiet`: dropped, accepted, and for the dead lens a survivor. Their Kind cell is the verdict, and the reason
     sits under the title in `<small>`. The per-lens count table and a separate raw listing are gone (Chris,
     2026-11-16).
2. **Units.** One section per unit the skill scanned, in the scan's order, with `data-annotate="<unit id>"`. A unit
   with findings shows one finding card each. A unit with no finding is one line: "No issues." The SKILL.md of
   each skill names its unit: refit-code a module, refit-docs a doc page, refit-tests a test file, refit-agents a
   loaded file (CLAUDE.md, skill or hook), refit-data a shown number, refit-design a component kind.
3. **Proposals.** Each change to the skill's reference doc that the scan asks for: where, the evidence and the
   sentence the doc needs. Omit the part when there are none. The skill changes no doc text.

## Finding card

One `<div data-annotate="f<n>">` per finding, inside its unit, strongest first, with `n` counting from 1 over the
report. The card shows no proof line: the hunt proves a finding, and the report does not repeat it (Chris,
2026-11-16). A finding that touches more than one unit sits in the unit of its owner and names the others in its
locations. The card holds, in this order (Chris, 2026-11-16):

1. **Title**: the change, as an imperative ("Parse issue refs in one place"). The badge row follows it: the lens,
   then its strength: one-way `Disagrees` (red) or `Duplicates` (amber); dead its tier; depth, seams, slop and
   layout their 1-5 rating or "proven". Then the signal that found it.
2. **Fix**: one sentence from the lens's Fix section. When a shared helper makes the fault, such as a fetch that
   writes the error line, the fix changes the helper, and every caller gets it (Chris, 2026-11-16). Mark a
   finding that needs [DEEPEN.md](DEEPEN.md).
3. **Before / after diagram**: before shows the copies, the shallow cluster or the crossing reads, with red
   dashed edges for disagreements and leaks; after shows the owner or deep module as one dark box, with the
   former copies as grey callers. Dead and slop findings may skip the diagram and show the lines removed. A layout
   finding shows the before and after file tree. A skill whose finding is text shows the text before and after.
4. **Details**: one closed `<details>`, summary "Details", that holds the rest:
   - **Locations**: a list, one `file:line` each, the owner first and marked.
   - **Guard**: the boundary rule as JSON in `<pre>`, or the lint pattern or tool rule in `<code>`, or "model:
     check" where no tool guards it.
   - **History**: the commits that already fixed drift here, when the git log shows them.
   - **ADR**: one amber line when the finding contradicts an ADR, with why it is worth reopening.
