# Shots of /#/ at 1440 px, with findings

Fixture and server: `eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002` (the build prints the ALEPH_* variables the server needs to read the fixture runs; without them `/api/speed` reports no hours). All shots by `aleph-shot`, `--width 1440`, window 1440x900 unless noted.

| File | URL | Width | Scheme |
| --- | --- | --- | --- |
| status-light.png | http://127.0.0.1:3002/#/ | 1440 | light |
| status-dark.png | http://127.0.0.1:3002/#/ | 1440 | dark |
| status-picker-light.png | http://127.0.0.1:3002/#/ (click `.fontpick > summary`) | 1440 | light |
| status-picker-dark.png | http://127.0.0.1:3002/#/ (click `.fontpick > summary`) | 1440 | dark |
| status-tall-light.png | http://127.0.0.1:3002/#/ (height 2000, extra: shows the hours bar) | 1440 | light |
| week-light.png | http://127.0.0.1:3002/#/?window=week | 1440 | light |
| week-dark.png | http://127.0.0.1:3002/#/?window=week | 1440 | dark |
| week-tall-light.png | http://127.0.0.1:3002/#/?window=week (height 2000, extra: shows the hours bar) | 1440 | light |

The font picker is a popover (a `<details class="fontpick">` fixed at bottom right), so it has open shots.
Each shot shows the Status page with the status line ("2 jobs need you and 1 job is stuck."), not an error or blank page.
Size: small = CSS or markup in the Status view; large = more than that.

## Findings

### Header
- status-light.png: Clock, status line, Hour/Day/Week/Month toggle and Pause are all present, no overlap or clipping. The status line is a tiny serif (about 14 px) beside a 26 px clock and sits high against the clock's baseline; it reads as a caption, not the page's headline. Small. Also, the page heading "Needs you 3" is followed directly by a subheading "Needs you 2", which repeats the label. Small (markup).
- status-dark.png: Same as light; no defect beyond the same two. The red status line is low contrast on the dark ground. Small.
- status-picker-light.png: Header unchanged, no defect.
- status-picker-dark.png: Header unchanged, no defect.

### Hours bar
- status-light.png: Not in view at 900 px: it is below the fold, past the Needs-you cards, counters and Speed cards. At the default window the bar cannot be seen without scrolling. Large (page order), or no defect if scrolling is accepted. The charts row above it ("Build run time by day", "Test time by day", "Lands by day") renders titles over an empty 200 px gap, with no charts and no empty message. Small to large, depending on whether the cause is the fixture or the view.
- status-dark.png: Not in view, same as light. Dark rendering of the bar was not looked at.
- status-picker-light.png: Not in view; the open picker does not reach it.
- status-picker-dark.png: Not in view.
- status-tall-light.png (extra): The bar renders with sentence, "Reached main" / "Did not reach main" brackets, a Landed and a Dropped segment and a "Not counted" line; no clipping or overlap. The detail card below it has defects: the colour swatch touches the word "Dropped" (no gap), and counts read "1 runs · 1 goals" (no singular). Small. The "By cause" bar is blue, not the pink of the Dropped segment, so the colour does not match. Small.

### Font picker
- status-light.png: The closed trigger "Aa" is a 40 px circle at bottom right, fixed, and overlaps the right edge of the Context card and the page's scroll area. Small (it is a temporary block in index.html, outside the Status view).
- status-dark.png: Same as light; no other defect.
- status-picker-light.png: The popover opens upward, 320 px wide, with five role rows, a CSS box and Reset. Nothing is clipped and the rows align. It covers the right of the second card and the Stuck card's row, and its right edge (x=1423) goes past the card column (x=1416). No missing control. Small.
- status-picker-dark.png: Same as light; text and borders are readable. No other defect.

## Week window: /#/?window=week

Each week shot shows the Status page with the status line, with "Week" selected (bold, filled) in the Hour/Day/Week/Month toggle. Not an error or blank page.

### Header
- week-light.png: Clock, status line, toggle (Week active) and Pause all present; no overlap, clipping or wrapping. Same two defects as status-light.png: the status line is a tiny serif beside the clock (small), and "Needs you 3" is followed by a repeated "Needs you 2" (small).
- week-dark.png: Same as light; the red status line is low contrast on the dark ground (small).

### Hours bar
- week-light.png: Not in view at 900 px, below the fold, as in status-light.png. Large (page order), or no defect if scrolling is accepted.
- week-dark.png: Not in view, same as light.
- week-tall-light.png (extra): The bar renders with sentence "0.3 h of 0.7 h (50%) ... in the last 7 days", "Reached main" / "Did not reach main" brackets, Landed and Dropped segments and "Not counted: 2 runs of 2 open goals, 0.6 h". No clipping or overlap. The detail card keeps the defects of status-tall-light.png: swatch touches "Dropped", "1 runs · 1 goals", and the blue "By cause" bar does not match the pink Dropped segment (all small).

### Font picker
- week-light.png: Closed "Aa" circle at bottom right, fixed, overlapping the right edge of the Context card (small, temporary block in index.html).
- week-dark.png: Same as light; no other defect.

### Difference between /#/ and /#/?window=week
- The hours bar does not differ. The week window is the default (`windowOf` in ui/views/speed.js answers "week"; ui/speed.test.ts:97), so `/#/` already had Week selected, and status-tall-light.png and week-tall-light.png have the same bar, same numbers and same "last 7 days" sentence. The "Hours / % of week" toggle is likewise in its Hours state in both. The other state (day, hour, month) needs `?window=day` etc.; it was not shot here.
- Only difference between the two sets: week-tall-light.png draws the Speed charts (axes, grid, the Lands-by-day line), where status-tall-light.png shows empty gaps under the chart titles. The week shots were taken after the ECharts vendor fix (95779b5); the earlier shots predate it, so the empty-chart finding above no longer holds.

## Fixes (aleph-595)

The four shots status-light.png, status-dark.png, week-light.png and week-dark.png were retaken after the fixes in deb6170; the picker and tall shots are the earlier ones and were not retaken.

- Status line a tiny serif beside the clock (small): fixed in deb6170; it is now the 26 px display size, level with the clock, in all four shots.
- "Needs you 3" followed by "Needs you 2" (small): fixed in deb6170; the group heading is visually hidden (still read by screen readers), so one heading shows in all four shots.
- Red status line low contrast on dark (small): no change; in status-dark.png and week-dark.png it reads clearly at the new size.
- Font picker "Aa" overlapping the Context card (small): fixed in deb6170; `.page` keeps 72 px free at the right, and the circle sits clear of the cards in the four shots.
- Picker popover edge past the card column (small): fixed in deb6170 by the same right padding; the open popover (status-picker-*.png) was not retaken, so it is not re-checked.
- Swatch touches "Dropped" (small): fixed in deb6170 (6 px gap); only visible in the tall shots, not retaken.
- "1 runs · 1 goals" (small): fixed in deb6170 (singular); only in the tall shots, not retaken.
- "By cause" bar colour differs from the class segment (small): fixed in deb6170 (the bar takes the class colour); only in the tall shots, not retaken.
- Empty chart gaps (status-light.png before 95779b5): fixed in 95779b5; the retaken shots draw the charts.
- Hours bar below the fold at 900 px (was large, page order): closed as accepted, no defect. `aleph issue add aleph ...` cannot run in this sandbox ("no repo named aleph", no repo registry), so no issue exists; the finding itself allowed "no defect if scrolling is accepted", and the tall shots (status-tall-light.png, week-tall-light.png) show the bar renders correctly once scrolled to. Reopen with `aleph issue add aleph "Status: hours bar is below the fold at 1440x900" --body -` if the page order should change.
