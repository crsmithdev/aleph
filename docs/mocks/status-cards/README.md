# Status card mocks

Design mocks for the Status page, from Chris's annotations on 2026-11-11. The live canvas is the Design artifact
https://claude.ai/artifact/Hf9FwxntRG5DPjoaRbkvGT. These files are its source: `canvas.json` and one `.dc.html` per
board. They need the canvas runtime (`support.js`) to render, so open the artifact to see them.

| Board | File | Decision |
|---|---|---|
| 3 · Pipeline drill-in | `Drill.dc.html` | A, built in `add05059`: each ring links to Jobs, filtered. The failed-share link waits on aleph-2002. B (an inline panel) and C (a hover card) are not built. |
| 4 · Agent Time bar | `Main.dc.html` | D, built in `add05059`: the share that reached main as the figure, a thin bar and a two-column legend. |
| 5 · Metric card vis | `Usage.dc.html` | Not built. |

## Metric card vis (board 5)

Every card is 116 px tall in every row, with a vis or without one. The first row of the board has no vis, for
comparison.

Chris kept these forms:

- current meter with a pace mark
- 1 · bullet bar
- 3 · burn-up strip, 10 px
- 4 · split meter
- 5 · ring, right of the figure
- New B · day columns, right of the figure
- New C · week segments

He dropped New A (the spark right of the figure) and New D (the background area).

The proposed mapping waits for Chris:

1. Usage: split meter with the pace mark.
2. Lost time: bullet bar against the baseline.
3. Completion and Landed: day columns from the `/api/flow` buckets.
4. Asks: burn-up strip.

Usage has no daily history, so it cannot have a spark or day columns.
