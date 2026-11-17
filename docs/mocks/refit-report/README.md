# Refit report sample

Request (Chris, 2026-11-16): one report shape across the refit skills, shown on the refit-design retro of
`#/factory/agents`. This round acts on his six shelf notes on the sample `20261116-220823-nedh`.

`index.html` is the sample. `app.css` links to `ui/app.css`, as in `agents-retro`. A real report copies the
CSS of the scanned commit, as `skills/refit/REPORT.md` (Directory) asks. A copy in the repo would repeat
`ui/app.css`. `shots/` holds the screenshots the findings use.

## Decisions

1. The per-lens count table is gone. Each candidate shows its lens in the Findings table instead (note 1).
2. The "Sample:" line is gone (note 2).
3. The summary sentence is gone. The Themes list carries it (note 3).
4. "By kind" and the raw listing are one Findings table: #, Finding, Kind, Lens. Dropped candidates come last in
   `tr.quiet`, with the reason under the title (note 4).
5. Components lists only the components with a broken rule. Passing entries, their `passes` badges and every
   "Rules followed" list are gone (note 5). I read "the passes part" to cover the followed lists too.
6. Design pass (note 6):
   - The Overview card closes before Components, so no card sits in a card (`docs/design.md`, Card: "Do not put a
     card in a card").
   - An entry names its variant in `span.quiet` on its own line, in place of an `h4` above it.
   - The `broken` badge on each finding is gone, because every finding left is broken (`docs/design.md`, Principle 6:
     "Do not fill a space because it is there").
   - A finding shown in two entries (3, 5, 12, 16) keeps its block in the first and an "Also" link in the second.

The shape rules changed with the sample: `skills/refit/REPORT.md`, `skills/refit/HTML.md` and
`skills/refit-design/REPORT.md`.

## Round 3

Chris's notes on round 2 (shelf `20261116-224328-gyi9`):

1. The row fold button goes in the first column. `docs/design.md`, Table, now puts it first in the column order.
   Finding 7's fix says so.
2. A finding card shows no proof line. The hunt proves a finding, and the report does not repeat it.
3. Each picture shows once. A later finding on the same picture has a "Shot: see" link to the first. This removes
   11 repeats, 6 of them of the Roles table.

4. Hold is now Guard in every refit skill: the card line, the `## Guard` lens sections and the `## Guards` tables
   (Chris, 2026-11-16). The factory's own holds keep their name.

## Round 5

Chris's notes on round 4 (shelf `20261116-230251-csrn`):

1. The Findings table starts closed, in a `<details>` whose summary gives the counts.
2. Finding 10 showed only the Success tile. It now shows the Roles card head with the aside, then the tile it
   repeats (`shots/roles-aside.png`, a crop of `old-14.png`).
3. A fix changes the shared helper that makes the fault. Finding 11 now fixes the Flow error line in the shared
   Flow fetch, so every Flow page gets it.
4. Size shows rank: the problem title at `--fs-2xl`, the fix at `--fs-lg` in `--ink`, the rule, locations and
   guard at `--fs-sm` in `--muted`. Each size and colour is a token (`docs/design.md`, Principle 1, "One token set, two
   themes").

## Round 6

Chris's notes on round 5 (shelf `20261116-231935-o3my`):

1. No part outranks its parent. The page title is `--fs-metric`, a card head `--fs-xl`, a kind head `--fs-2xl`, a
   finding title `--fs-lg` and the fix `--fs-md`.
2. The fix sits under the title, before the screenshots.
3. Screenshots have no caption. The `alt` text names the part.
4. The rule, the locations, the "Shot: see" line and the guard sit in one closed Details fold.

## Round 7

Chris's notes on round 6 (shelf `20261116-232446-lquk`), and his answers in chat:

1. The Actions list is gone. It repeated the Fix titles that Themes already groups. The Themes list now carries
   the order to act, with the rank that Actions used.
2. Component entries do not fold (Chris undid the round 7 fold). The entry's first line, such as "Success value and
   trend", is the parent of its findings. So it now sits at `--fs-lg` in `--ink`, above the finding title at
   `--fs-md`. The fix moves to `--fs-sm`, and the rule, locations and guard to `--fs-xs`. This follows round 6:
   no part outranks its parent.
3. The refit-code finding card takes the same order: title and badges, fix, diagram, then one closed Details
   fold with the locations, guard, history and ADR line.

## Round 8 variant: finding first

Chris asked to see the finding first, with the component line under it.

1. Each kind head lists its findings in page order. The finding title is the top line, at `--fs-lg`.
2. Under the title, one muted line at `--fs-sm` per component the finding breaks, with the Kit link. The
   `data-annotate` moves to that line.
3. The "Also" lines are gone. A finding in two components shows two component lines: 3, 5, 12 and 16.
4. Field and form has no finding of its own. Its checkbox shows under 16, in Table.
5. The fix is at `--fs-md` and the Details text at `--fs-sm`, as in round 6.

Chris picked the finding-first variant (2026-11-17). It is now `index.html`, and the component-first draft is gone.
`skills/refit-design/REPORT.md` (Finding) gives the new order.
