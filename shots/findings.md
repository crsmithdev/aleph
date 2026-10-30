# aleph-553: Status layout shots (review fixture)

Shots in this directory: `before-*` and `after-*`, 1440x900 and 390x844, Hour and Week. The `*-full` files are the same pages at 3200 px tall, because the 900 px viewport ends inside Needs you and never reaches the flow strip, Speed or the lanes.

## Defect found and fixed
- **Efficiency cards at 390 px (and 721-1020 px)**: five cards stayed in one row. "RERUNS" and "FIRST PASS" clipped, and the captions wrapped one word per line. Cause: `.meds.eff` (5 columns) outranks the `.meds` rules in the max-width media queries. Fix: `.meds.eff` rules in ui/index.html (3 columns up to 1020 px, 1 column up to 720 px). Test: last test in ui/now.test.ts.

## Per shot
- 1440 Hour: Needs you, flow strip, Speed and Efficiency fit with no overflow. Hour has no landed goals, so Efficiency shows "–" and "no goal landed". That is correct. Nothing changed.
- 1440 Week: Done 1, Speed fills in, Efficiency shows the Landed/Dropped bar and the Dropped breakdown. The toggle changes the view. Nothing changed.
- 390 Hour: lede, picker and Needs you wrap cleanly and the flow strip stacks. The Efficiency cards were clipped (before); after the fix they stack one per row.
- 390 Week: same. The lanes stack in one column.

## Not fixed
- The three Speed charts are blank in every shot. The chart library is probably not reachable in the shot browser. I could not tell this from a view bug, so I changed no code.
- At 390 px the top nav row is cut off at "S" (it scrolls sideways). That looks intended.
