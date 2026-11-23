# Refit code report

Request (Chris, 2026-11-20): a design and readability pass on refit-* output, with the refit-code scan of
`64605811` (shelf `20261121-032529-qbt0`) as the example.

`build.py` draws `findings.json` (the run's record) in the new shape. `figures.json` holds the run's own figures, cut
from its `index.html`. Run `python3 build.py` to write `index.html`.

## Cause

The refit-design sample (`docs/mocks/refit-report/`, rounds 1-8) set the sizes, the `.finding` block and the
Details fold. `skills/refit/HTML.md` holds none of that CSS, so the refit-code agent wrote bare markup: every
line at body size, 58 findings in one 23,955 px column.

## Decisions

1. Split by tier. Ask (14) comes first and open; Auto (44) folds to one row each. Chris acts on the ask
   findings, and an auto fix keeps behaviour (`design.md`, Principle 6).
2. Group by lens, not by unit. In this run 40 of 47 units held one finding, so a unit head cost a row per
   finding. The unit moves onto the row as muted mono text.
3. Overview is three counts: ask, auto, dropped, each a link to its card. Lenses, seed and sweep go into one
   closed fold. The legend moves to the Ask card, above the first figure.
4. A row reads: number, title, unit, strength badge, signal. The lens chip is gone, because the group head names it.
5. Before and after is a `.diff-panel` with `d-del` and `d-add` lines (`design.md`, Diff), not two `<pre>`
   blocks with "Before:" and "After:".
6. Sizes follow the round 6 rule of `refit-report` (no part outranks its parent) with the round 7 sizes. Card head `--fs-xl`, lens head `--fs-lg`,
   finding title `--fs-md`, fix `--fs-sm`, Details `--fs-xs`.
7. The figure caption drops the title it repeated.
8. The Findings table keeps only the 45 dropped candidates. The findings are now rows on the page.
9. Clean units are one line at the end of Auto: "No findings: ...".

## Settled

Chris accepted the mock on 2026-11-20 ("looks good"), and asked for it as the refit format:

- Auto rows fold.
- The shape is now `skills/refit/REPORT.md` and `skills/refit/HTML.md`, with `skills/refit/report.css` and
  `skills/refit/example.html`. Run `python3 build.py example` to write the example from this run.
- A figure label holds the whole file name (HTML.md, Figure). `build.py` mends the run's cut file names. Its cut
  symbol labels stay, as the run drew them.
