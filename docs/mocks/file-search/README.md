# File from the search: placement

Request (Chris, 2026-11-17): show the “File …” offer of the Issues search without a table row and without moving the table. Mock the search box, beside it, or in it.

| Option | Where | Shift | Rule |
|---|---|---|---|
| A (recommended) | A hint button inside the search box, right end | none | design.md Principle 6, terse text: “↵ File in aleph” |
| B | A File button after the search box | none | Principle 6, “Do not fill a space because it is there”, weighs against a standing control used rarely |
| C | The Issues card head, after the count | none at 1440px, one line at 390px | Card head `.sh .aside` |
| D | A's hint, plus the offer in the empty-table line when nothing matches | none | `empty()` line keeps its spot |

The cards use `app.css` (copied from `ui/app.css`) and the kit markup: `.fbar`, `.card .sh`, `table.tbl`. Only the in-box hint (`.infile .hint`) is new CSS.
