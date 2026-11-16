# Retro report

The report of a refit `retro`. All six refit skills write this shape. A skill adds to the Header or names its unit in
its own SKILL.md. refit-design adds the rules in its [REPORT.md](../refit-design/REPORT.md). The sweep reports in
the terminal instead. [HTML.md](HTML.md) has the scaffold, the diagram patterns and the tone.

## Directory

Write `<tmpdir>/refit-<skill>-retro-<timestamp>/`, with `<tmpdir>` from `$TMPDIR`, else `/tmp`:

- `index.html`: the report.
- `app.css`: a copy of `ui/app.css` from the scanned commit (`git show <commit>:ui/app.css`), so the report keeps its
  look when the CSS changes. If the repo has no `ui/app.css`, use a small inline `<style>` and the same class names.
- Other files the report needs, such as screenshots. Link each with a relative path.

## Parts

Five parts, in this order. Each is a `<section class="card">`, so `.card` rules apply and no card sits in a card:
a variant is an `<h3 class="sub-head">`, not a card.

1. **Header.** Repo name, date, the commit scanned, the scope, the lenses run. A count line per lens: candidates,
   findings, dropped. A skill's own additions stay (see its SKILL.md). refit-code adds a legend (box = module or
   copy, dark box = owner or deep module, red dashed line = disagreement or leak, grey box = caller) and a seed
   line: the top files, pairs and copies that `cochange.ts seed` gave. Use `.facts` for the first four and a table
   for the lens counts.
2. **Summary.** The findings grouped by kind and then by theme inside a kind: one `<h3 class="sub-head">` per theme,
   one line for each finding with its title and unit. The kinds are the skill's lenses. Then **Actions**: a numbered
   list in the order to act, one sentence each. Rank first by drift or failure that already cost a fix, then by how
   many callers or pages the finding touches, then by the lines it removes. A repeated cause is one theme and one
   action. This part replaces a top finding.
3. **All candidates, raw.** One `<details>` that is closed. It holds one table: one row per candidate, with every
   field the hunt returned, copied verbatim (lens, concept or file, each `file:line`, the signal, the proof text),
   then the verdict (finding, dropped, accepted) and its reason. Add no field and edit no text. It replaces the
   Accepted and Dropped tables. For the dead lens, a survivor is a row with the verdict "survivor", and its
   reason is the escape hatch that saved it.
4. **Units.** One section per unit the skill scanned, in the scan's order, with `data-annotate="<unit id>"`. A unit
   with findings shows one finding card each. A unit with no finding is one line: "No issues." The SKILL.md of
   each skill names its unit: refit-code a module, refit-docs a doc page, refit-tests a test file, refit-agents a
   loaded file (CLAUDE.md, skill or hook), refit-data a shown number, refit-design a component kind.
5. **Proposals.** Each change to the skill's reference doc that the scan asks for: where, the evidence and the
   sentence the doc needs. Omit the part when there are none. The skill changes no doc text.

## Finding card

One `<div data-annotate="f<n>">` per finding, inside its unit, strongest first, with `n` counting from 1 over the
report. A finding that touches more than one unit sits in the unit of its owner and names the others in its
locations. The card holds:

- **Title**: the change, as an imperative ("Parse issue refs in one place").
- **Badge row**: the lens, then its strength: one-way `Disagrees` (red) or `Duplicates` (amber); dead its tier;
  depth, seams, slop and layout their 1-5 rating or "proven". Then the signal that found it.
- **Locations**: a list, one `file:line` each, the owner first and marked.
- **Before / after diagram**: before shows the copies, the shallow cluster or the crossing reads, with red
  dashed edges for disagreements and leaks; after shows the owner or deep module as one dark box, with the
  former copies as grey callers. Dead and slop findings may skip the diagram and show the lines removed. A layout
  finding shows the before and after file tree. A skill whose finding is text shows the text before and after.
- **Proof**: one sentence from the lens's proof bar: the input with two results, the deletion test result, the
  crossing reads, the removal gate clause, the escape hatches ruled out, or the look-first test.
- **Fix**: one sentence from the lens's Fix section. Mark a finding that needs [DEEPEN.md](DEEPEN.md).
- **Hold**: the boundary rule as JSON in `<pre>`, or the lint pattern or tool rule in `<code>`, or "model:
  check" where no tool holds it.
- **History**: the commits that already fixed drift here, when the git log shows them.
- **ADR**: one amber line when the finding contradicts an ADR, with why it is worth reopening.
