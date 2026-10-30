# Shots of /#/ at 1440 px, with findings

Fixture: `bun ui/fixtures/review/build.ts /tmp/fx`; server: `bun ui/server.ts --port 3002`. All shots by `aleph-shot`, `--width 1440`, window 1440x900 unless noted.

| File | URL | Width | Scheme |
| --- | --- | --- | --- |
| status-light.png | http://127.0.0.1:3002/#/ | 1440 | light |
| status-dark.png | http://127.0.0.1:3002/#/ | 1440 | dark |
| status-picker-light.png | http://127.0.0.1:3002/#/ (click `.fontpick > summary`) | 1440 | light |
| status-picker-dark.png | http://127.0.0.1:3002/#/ (click `.fontpick > summary`) | 1440 | dark |
| status-tall-light.png | http://127.0.0.1:3002/#/ (height 2000, extra: shows the hours bar) | 1440 | light |

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
