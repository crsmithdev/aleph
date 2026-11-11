# Retro report

One self-contained HTML file at `<tmpdir>/refit-code-retro-<timestamp>.html`, with `<tmpdir>` from `$TMPDIR`, else
`/tmp`. [HTML.md](HTML.md) has the scaffold, the diagram patterns, the style and the tone. The sweep
reports in the terminal instead.

## Header

Repo name, date, the commit scanned, the scope, the lenses run, and a legend: box = module or copy, dark box =
owner or deep module, red dashed line = disagreement or leak, grey box = caller. A count line per lens:
findings, accepted, dropped. A seed line: the top files, pairs and copies that `cochange.ts seed` gave.

## Finding card

One `<article>` per finding, strongest first:

- **Title**: the change, as an imperative ("Parse issue refs in one place").
- **Badge row**: the lens, then its strength: one-way `Disagrees` (red) or `Duplicates` (amber); dead its tier;
  depth, seams, slop and layout their 1-5 rating or "proven". Then the signal that found it.
- **Locations**: `font-mono text-sm` list, one `file:line` each, the owner first and marked.
- **Before / after diagram**: before shows the copies, the shallow cluster or the crossing reads, with red
  dashed edges for disagreements and leaks; after shows the owner or deep module as one dark box, with the
  former copies as grey callers. Dead and slop findings may skip the diagram and show the lines removed. A layout
  finding shows the before and after file tree.
- **Proof**: one sentence from the lens's proof bar: the input with two results, the deletion test result, the
  crossing reads, the removal gate clause, the escape hatches ruled out, or the look-first test.
- **Fix**: one sentence from the lens's Fix section. Mark a finding that needs [DEEPEN.md](DEEPEN.md).
- **Hold**: the boundary rule as JSON in `<pre>`, or the lint pattern or tool rule in `<code>`, or "model:
  check" where no tool holds it.
- **History**: the commits that already fixed drift here, when the git log shows them.
- **ADR**: one amber line when the finding contradicts an ADR, with why it is worth reopening.

## Accepted and dropped

Two tables. Accepted: each candidate that `.refit.json` keeps on purpose, with its recorded reason. Dropped:
candidate, lens, why it is not a finding. For the dead lens the dropped table is the **survivors**: each with
the escape hatch that saved it.

## Top finding

One card: the finding to act on first and one sentence why. Rank first by drift or failure that already cost a
fix, then by how many callers the finding touches, then by the lines it removes.
