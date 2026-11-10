# Retro report

One self-contained HTML file at `<tmpdir>/one-way-retro-<timestamp>.html`, with `<tmpdir>` from `$TMPDIR`,
else `/tmp`. Take the scaffold, the CDN scripts, the diagram patterns and the style guidance from
[`../improve-codebase-architecture/HTML-REPORT.md`](../improve-codebase-architecture/HTML-REPORT.md). This
file states only where a retro report differs.

## Header

Repo name, date, the commit scanned, the scope, and a legend: box = copy, dark box = owner, red dashed line
= disagreement, grey box = caller. A count line: findings, of which disagree today, accepted and dropped candidates. A seed line: the top
files and pairs that `cochange.ts seed` gave.

## Finding card

One `<article>` per finding, in the order of step 4:

- **Title**: the change, as an imperative ("Parse issue refs in one place").
- **Badge row**: `Disagrees` (red) or `Duplicates` (amber), plus the signal that found it.
- **Copies**: `font-mono text-sm` list, one `file:line` per copy, the owner first and marked.
- **Before / after diagram**: before shows each copy as a box, a red dashed edge between each pair that
  disagrees, labelled with the input; after shows the owner as one dark box, with the former copies as grey
  callers. Mermaid `flowchart` fits most findings.
- **Disagreement**: one sentence with the concrete input and both results, or the commit that fixed one
  copy and missed the other.
- **Owner**: one sentence: which copy stays and what the others become.
- **Hold**: the `.jscpd.json` boundary rule that keeps the owner's code in place, as JSON in `<pre>`, or
  the pattern a lint would ban outside the owner, in `<code>`.
- **History**: the commits that already fixed drift in this concept, when the git log shows them.

## Accepted and dropped

Two tables. Accepted: each candidate that `.one-way.json` keeps on purpose, with its recorded reason.
Dropped: candidate, why it is not a finding (copies do different jobs, one is dead code, they cannot drift).

## Top finding

One card: the finding to fix first and one sentence why. Rank first by drift that already cost a fix, then
by how many callers read the wrong copy.
