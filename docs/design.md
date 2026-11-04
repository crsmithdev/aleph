# UI design reference

The design language of the aleph UI (`ui/`), read from the code by the design-language skill (`skills/design-language/SKILL.md`, Extract mode). It records what the code already mostly does; a value that bypasses it is a deviation, listed at the end. The fixes are in `docs/findings/2026-11-03-ui-design-fixes.md`.

Counts come from `bun skills/design-language/scripts/inventory.ts ui` and `--summary`, run on the finished tree. A count read from the code instead gives its `file:line`. Totals:

| group | kind | count |
|---|---|---|
| colour | literal | 19 |
| colour | token-def | 85 |
| effect | literal | 48 |
| effect | token-use | 1 |
| format | helper-bypass | 77 |
| size | literal | 476 |
| size | token-def | 12 |
| size | token-use | 184 |
| type | literal | 60 |
| type | token-def | 31 |
| type | token-use | 14 |

## What could not be determined

- **Earlier decisions.** Absolute time is `10/28 14:05` (mm/dd hh:mm, 24-hour): Chris chose it on 2026-11-04 for aleph-1163, the same format as the aleph-199 decision (vault note "Triage Questions Go To Chris And Times Read mm-dd hh-mm"). A chart axis can keep a short form. No other UI decision outranks the code here.
- **Browser checks.** Chrome cannot start in the sandbox, so no page was rendered, in light or dark, at desktop or phone width. Responsive behaviour below is read from the media queries; chart empty and loading states, and whether a table scrolls or wraps at a phone width, are read from the code and not seen.
- **Colour token uses.** The inventory has no `token-use` kind for colours: `var(--ink)` and the like are not counted, so a colour token has a definition count (three blocks) and no use count.
- **Contrast.** Computed from the hex values in `ui/app.css` for the pairs below, not for every text and background pair that the CSS puts together. The pair `--muted` on `--rule-2` (4.41 light, 4.35 dark) was not traced to a use.
- **Inventory false positives.** `ui/views/efficiency.js:113` is read as the colour literal `#eff`, but the line is `root.querySelector("#eff")`, an element id selector, not a colour. The inventory reads text, so it counts it in the colour literals.
- **Chart data.** No chart was drawn with real data.

## Principles

1. **One token set, two themes.** Colours are CSS custom properties on `:root` (`ui/app.css:3`), re-set for dark in two identical blocks, the `prefers-color-scheme` one at `ui/app.css:87` and the `data-theme="dark"` one at `ui/app.css:119`. Light is a lavender match for Palenight; dark is Palenight (Mild Contrast).
2. **Shared helpers build the parts.** Views call `ui/lib.js` for a page head, card, table, badge, chip, filter bar, pager, tile and bar list, and the CSS for them is in `ui/app.css`.
3. **Meaning is a tone.** A state is `run`, `done`, `need`, `stuck` or `quiet`, mapped by `tone()` in `ui/lib.js:282`, and the same tone colours a badge, a chart series and a tile.
4. **Numbers are tabular.** `font-variant-numeric: tabular-nums` has 12 literal uses, and number columns are right-aligned.
5. **Plain text states.** An empty state is one sentence and one hint, a missing value is `–`, and sentences end with a full stop.

## Tokens

All colour tokens are defined in three blocks of `ui/app.css`: light (`:root`), dark by media query, and dark by `data-theme`. That is the 85 colour `token-def` rows. Light and dark values are in `ui/app.css:3-56`, `ui/app.css:87-115` and `ui/app.css:119-146`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | #F4F3FA | #202331 | the page |
| `--surface` | #FFFFFF | #292D3E | cards, the editor |
| `--sunk` | #ECEAF6 | #191C28 | chips, fields, code blocks, row hover |
| `--ink` | #292D3E | #EEF1F8 | text |
| `--ink-2` | #4A4F6A | #BFC7D5 | secondary text |
| `--muted` | #62688A | #8E96BA | headers, meta |
| `--rule`, `--rule-2` | #DCD9EC, #E8E6F3 | #3A3F58, #2E3245 | borders, row lines |
| `--run` / `--run-bg` | #3B5FC8 / #EBEFFA | #82AAFF / #353E59 | running |
| `--done` / `--done-bg` | #437018 / #EDF2E8 | #A9C77D / #3B4347 | delivered |
| `--need` / `--need-bg` | #8A5A00 / #F3EEE6 | #FFCB6B / #474344 | needs you |
| `--stuck` / `--stuck-bg` | #C0304C / #F9EAED | #F07178 / #3D2C39 | stuck, error |
| `--add`, `--del` | #437018, #C0304C | #A9C77D, #F07178 | diff lines |
| `--focus` | #7E57C2 | #C792EA | focus ring |
| `--good`, `--hot` | #437018, #C2521F | #C3E88D, #F78C6C | a trend that improves; the largest cause |
| `--raised` | #ECEAF6 | #32374D | a selected tile |
| `--approve`, `--decide`, `--unstick`, `--hand` | see `ui/app.css:30-32` | see `ui/app.css:112-114` | the four Ask cards, each with `-bg` and `-ring` |
| `--seg-landed`, `-fixed`, `-nothing`, `-restarted`, `-dropped` | `ui/app.css:35` | same in both themes (not re-set in dark) | Efficiency outcome bar, under white text |
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #1BAF7A, #EDA100, #E87BA4 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #C792EA, #89DDFF | extra chart series |
| `--lift` | `0 1px 3px` and `0 2px 8px` shadows | heavier black shadows | the top Status card; 1 `token-use` |

Type, size and effect tokens (`ui/app.css:47-55`):

| Token | Value | Role | Uses |
|---|---|---|---|
| `--fs-2xs` | 11px | badges and ids on narrow cards, bar labels | 3 |
| `--fs-xs` | 12px | table headers, meta, badges | 41 |
| `--fs-sm` | 13px | table cells, secondary text | 54 |
| `--fs-md` | 14px | body | 6 |
| `--fs-lg` | 15px | section headings | 7 |
| `--fs-xl` | 26px | page title, in `--display` | not counted, used in shorthand `font:` |
| `--fs-metric` | 32px | the figure on a tile | not counted, used in shorthand `font:` |
| `--fw-text` | 400 | text | not counted, used in shorthand `font:` |
| `--fw-mid` | 500 | ids and numbers | not counted, used in shorthand `font:` |
| `--fw-strong` | 600 | headings and table headers | not counted, used in shorthand `font:` |
| `--r-card` | 10px | cards, tiles | 8 |
| `--r-ctl` | 6px | controls | 19, and 2 in mixed shorthands |
| `--r-tag` | 4px | badges, code blocks | 20, and 1 in a mixed shorthand |
| `--r-hair` | 2px | bars, marks, thin rules | 11, and 1 in a mixed shorthand |
| `--r-pill` | 999px | chips, pills | 3 |
| `--gap-in` | 16px | between tiles and side-by-side cards | 7 |
| `--gap` | 24px | between page blocks | 1 |
| `--sans`, `--mono`, `--num`, `--display`, `--metric`, `--brand` | Work Sans, Hack Nerd Font, Merriweather families | body, code, numbers, titles | `--mono` 10, `--num` 2, `--sans` 1, `--display` 1 as `font-family` |

Weights are tokens: `--fw-text` 400 for text, `--fw-mid` 500 for ids and numbers, `--fw-strong` 600 for headings and table headers. 700 stays a literal on `.mark` and `.tile b`.

Breakpoints are not tokens, because custom properties do not work in `@media`. There are two named widths: 720px and 1100px (wide). The queries in `ui/app.css` are `(max-width: 720px)` 10 times, `(max-width: 1100px)` 3 and `(min-width: 721px)` 1.

Spacing has no tokens. The most common literals are `gap: 8px` (22), `gap: 6px` (16), `gap: 4px` (10), `gap: 10px` (10) and `margin-top: 4px` (9); `margin: 0 0 8px` has 8, `gap: 12px` 7, `gap: 2px` 7 and `padding: 10px 12px` 6. The scale in use is 2, 4, 6, 8, 10, 12, 16 px.

Radii: the five `--r-*` tokens; one literal is left, `6px` on the login page (`ui/auth.ts:54`). Shadows: `--lift`, plus `box-shadow: inset` rings for selected and parked states. Layers: `z-index` has 4 literal uses (1, 2, 2, 50). Motion: 2 `transition` literals (`.15s ease-out`), one `pulse` animation switched off under `prefers-reduced-motion` (`ui/app.css:414`).

Rules taken from the audit of 2026-11-04 (`docs/findings/2026-11-04-ui-design-audit.md`). Each pattern has 3 or more uses and no token yet. Until its token lands, use the value given here.

| Rule | Value | Uses | Token to come |
|---|---|---|---|
| Spacing | a step of 2, 4, 6, 8, 10, 12 or 16 px for `gap`, `padding` and `margin` | 337 rows | spacing tokens (fixes item 12) |
| Dimmed control | `opacity: .6` | 3 (`ui/app.css:322`, `343`, `963`) | `--dim` |
| Display type tracking | `letter-spacing: -0.01em` on the brand mark, page title and display text | 4 (`ui/app.css:165`, `190`, `191`, `479`) | none; a rule |
| Small-caps key tracking | one value for uppercase keys; today `.06em` (`ui/app.css:564`) and `.08em` (`ui/app.css:722`) | 2 | none; pick one when a third key comes |
| Control height | 28px | 9 (`min-height` 6, `height` 3) | `--ctl-h` |
| Bar and meter height | 10px | 8 | `--bar-h` |

## Formats

One format per kind of value. The helpers are in `ui/lib.js` unless named.

| Kind | Format | Example | Helper | Missing |
|---|---|---|---|---|
| Absolute time | mm/dd hh:mm, 24-hour; `YYYY-MM-DD` in another year | 10/28 14:05 | `when()` (`ui/lib.js:294`) | empty string |
| Day | month name and day; `YYYY-MM-DD` in another year | Oct 28 | `day()` (`ui/lib.js:309`), `dateText()` (`ui/views/issues.js:206`) | empty string |
| Axis hour | 12-hour, `a` or `p` | 4a, 1:36p | `hourLabel()` (`ui/lib.js:303`), for a chart axis only | none |
| Clock | 24-hour time | 14:05 | `clock()` | empty string |
| Duration | seconds, minutes, hours | 43s, 4m 05s, 1h 02m | `dur()`, `durMs()`, `span()`, `elapsed()` | `–` from `dur()`, empty from `durMs()` |
| Cost | dollars, 2 decimals, `<$0.01` under half a cent | $1.25 | `money()` (`ui/lib.js:18`) | `$0.00` |
| Weekly share | `≈1.4% wk` | ≈1.4% wk | `wkText()` (`ui/lib.js:21`), `costHtml()` | empty string |
| Percent | whole number from 1%, one decimal below, `<0.1%` under 0.05% | 12%, 0.4% | `pct()` (`ui/lib.js:23`) | `–` |
| Count | thousands separators | 12,345 | `count()` (`ui/lib.js:19`) | none |
| Ids | mono, muted, `500 var(--fs-xs)` | aleph-52 | `idLink()`, `repoIdLink()` | none |
| Model | name without `claude-` and the version | opus | `shortModel()` | empty string |
| Bytes | `B`, `KiB`, `MiB`, one decimal | 1.5 KiB | `kb()` (`ui/views/jobs.js:127`); move to `ui/lib.js` as `bytes()` at a second use | none |
| Mean | one decimal | 2.4 | `toFixed(1)` (`ui/views/factory-agents.js:19`, `36`) | `–` |
| Countdown | `m:ss` | 4:05 | `ui/index.html:221` | none |

Every absolute time goes through `when()`; a chart axis uses `day()` or `hourLabel()` (`xLabel()`, `ui/views/speed.js:23`). The `format` group has 77 `helper-bypass` rows; the audit marks each one (`docs/findings/2026-11-04-ui-design-audit.md`).

## Tables

The one table is `dataTable()` (`ui/lib.js:480`) with `heads()` or `sortHead()` (`ui/lib.js:496`), styled by `table.tbl` (`ui/app.css:438`). Six tables are written by hand with `<table class="tbl">` and not through `dataTable()`: `ui/views/issues.js:241`, `ui/views/issues.js:617`, `ui/views/jobs.js:240`, `ui/views/memory.js:46`, `ui/views/session.js:23` and `ui/views/session.js:259`.

Rules, as the code states them (`ui/lib.js:289`, `ui/app.css:438`):

- **Column order:** id or name, title, state badge, project, labels, numbers, time last.
- **Spare width:** the widest text column is `td.wide`; it is cut with an ellipsis (`max-width: 0`, `overflow: hidden`).
- **Alignment:** text left; numbers right with `th.num` and `td.num`, in `--num` with tabular figures and weight 500.
- **Cells:** `white-space: nowrap`, padding `6px 12px 6px 0`, a `--rule-2` line under each row, and `--sunk` on row hover. Headers are `600 var(--fs-xs)` in `--muted`.
- **Sort:** a header button with `data-sort`; the sorted header is `--ink` with `aria-sort`, and the arrow is `▲` or `▼`.
- **Pager:** `pager()` shows "50 of 345" and "Show 50 more"; `PAGE` is 50 in `ui/views/issues.js:55` and `ui/views/jobs.js:56`.
- **Wide tables:** `.tscroll` scrolls sideways.
- **Empty table:** `empty()` in place of the table.

Columns of the main tables:

| Table | Columns, in order | Source |
|---|---|---|
| Issues | Id, Title, Stage, Project, Priority, Labels, Notes (num), Runs (num), Cost (num), Age (num), Updated, (actions) | `ui/views/issues.js:182` |
| Jobs | Job, Title, State, Project, Model, Took (num), Cost (num), Started | `ui/views/jobs.js:96` |
| Sessions | Session, First prompt, Project, Kinds, Turns (num), Cost (num), Started, Last | `ui/views/sessions.js:120` |
| Memory notes | Title, Kind, Scope, Read, Written, Status | `ui/views/memory.js:274` |
| Turns of a session | Turn (num), Prompt, Output, Model, Tools (num), Duration (num), Cost (num), Started | `ui/views/session.js:23` |
| Observations | Kind, Name, Detail, Duration (num) | `ui/views/session.js:259` |
| Gates log | When, By, Item, What | `ui/views/gates.js:163` |
| Hooks | Hook, Calls (num), Errors (num), Last | `ui/views/sessions.js:105` |
| Denials | Reason, When | `ui/views/sessions.js:108` |
| Efficiency | Issue, Why, Hours (num), Runs (num); Issue, Usage (num), Runs (num) | `ui/views/efficiency.js:52`, `ui/views/efficiency.js:71` |
| Agents by role | Role, one number column per measure, Models | `ui/views/factory-agents.js:25` |
| Job checks | Check, Result, Time (num), Log | `ui/views/jobs.js:240` |
| Commits | Commit, Subject, Part, Date | `ui/views/issues.js:617` |

Gaps: the time column is `Started`, `Updated`, `Last`, `When`, `Date` or `Written` depending on the table, and a missing cell is empty in some tables and `–` in others. Row height is set by padding, not by a value. Row actions sit in the last column in the Issues table (`act`) and are absent elsewhere. Expansion is by `<details>` in lists, not in tables. Filters are a `.fbar` over the table.

## Charts and data displays

Charts are ECharts, themed by `chartTheme()` and drawn by `chart()` (`ui/lib.js:159`, `ui/lib.js:184`); the theme reads the page tokens through `readTokens()` (`ui/lib.js:174`) and redraws on a colour-scheme change.

- **Series colours:** `--run`, `--done`, `--need`, `--stuck`, then `--chart-6` and `--chart-7`; agent roles use `--series-1` to `--series-5`.
- **Bars:** `barsOption()` (`ui/lib.js:480`) for counts over categories, with no animation, `barMaxWidth: 64` and a shadow-pointer tooltip. Uses: `ui/views/factory-agents.js:33`, `ui/views/issues.js:312`, `ui/views/issues.js:313`, `ui/views/factory-jobs.js:21`.
- **Lines:** `lineOption()` (`ui/lib.js:480`) for one series over time, filled at 15% opacity, or as a step area (85%) for live counts. Uses: `ui/views/factory-agents.js:37`, `ui/views/factory-agents.js:49`, `ui/views/skills.js:33`.
- **Axes:** category x axis, value y axis from 0 with whole-number steps. The x label is `xLabel()` (`ui/views/speed.js:23`): `4a` or `1:36p` in the hour and day windows, `Oct 25` in week and month.
- **Metric tiles:** `tile()` (`ui/lib.js:433`): a small caps key, the figure in `--metric` at 32px, and a small line. A tile with `key` selects the detail below it.
- **Bar lists:** `barRow()` and `barList()` (`ui/lib.js:480`): label, bar, value on one grid.
- **Badges and chips:** `badge()` and `priorityBadge()` (`ui/lib.js:341`, `ui/lib.js:345`) are squared with `--r-tag`; `chips()` (`ui/lib.js:351`) are pills.
- **Efficiency bar:** `.obar`, in the five `--seg-*` colours under white text.
- **Loading and empty:** a chart's loading line is `<p role="status">Loading…</p>` (`ui/views/factory-agents.js:54`). Units and legends are not set in one place; each option names its series.

## Interaction

- **Focus:** one ring for all, `2px solid var(--focus)` with a 2px offset (`ui/app.css:162`). Segmented buttons, rows and the Ask head use a negative offset (`ui/app.css:496`, `ui/app.css:671`, `ui/app.css:996`).
- **Hover:** a link or button darkens its border to `--ink-2` (`.act`, `.cmd`, cards) or its text to `--ink` (crumbs, `a.idl`, sort buttons); a table row and a nav item take `--sunk`; a tile takes a `--run` border.
- **Pressed:** a selector (tile, segmented button, bar row) sets `aria-pressed="true"`, drawn with `--raised`, `--rule-2` or `--sunk`.
- **Disabled:** `.act:disabled` is 60% opacity with a wait cursor (`ui/app.css:322`).
- **Active:** `.cmd:active` moves 1px down.
- **Disclosure:** `<details>` for the fold in a list and for the Ask card (`.ask-fold`); the open state of each is kept across a redraw by `recordState()` and `restoreState()` (`ui/lib.js:229`, `ui/lib.js:242`).
- **Motion:** `.15s ease-out` on borders and backgrounds; the one animation (`pulse`) stops under `prefers-reduced-motion` (`ui/app.css:414`).

## Content

- **Markdown:** `md()` (`ui/lib.js:110`) renders into `.md`; headings are `600 var(--fs-lg)` in the sans face.
- **Code:** `pre` and `code` use `--mono` at `--fs-xs`; blocks sit on `--sunk` with `--r-tag` and wrap (`ui/app.css:713`) or scroll (`.md pre`, `ui/app.css:589`).
- **Diffs:** `.diff-panel` on `--sunk`, max height 480px, added lines `--add`, removed `--del`, hunks `--muted` (`ui/app.css:324`).
- **Command box:** `cmd()` (`ui/lib.js:84`) renders `.cmd`, a mono button that copies on click with a `.cp` control; `primary` inverts it.
- **Not determined:** the wrap rule of every long-text view was not traced.

## Voice and copy

- **Headers:** sentence case for page and section titles (`Efficiency`, `Uses per day`); table headers in sentence case (`First prompt`); tile keys are uppercased by CSS (`text-transform: uppercase`, 2 uses).
- **Buttons:** short verbs (`Show 50 more`, `Log out`).
- **States:** lower case (`running`, `landed`, `awaiting`), listed in `STATES` (`ui/lib.js:282`); a priority is `critical`, `high`, `medium` or `low`.
- **Empty:** one sentence with a full stop and an optional hint, through `empty()` (`ui/lib.js:61`): "Nothing waits for you." (`ui/views/gates.js:94`), "No job matches." with "Widen the window or clear a filter." (`ui/views/jobs.js:87`).
- **Loading:** `Loading <title>…` (`ui/lib.js:80`).
- **Error:** `error()` (`ui/lib.js:80`) says what failed, and the default hint is "Check that aleph-ui is running, then reload."
- **Offline:** "The server is unreachable. Showing the last data." (`ui/index.html:31`).
- **Missing value:** `–`, except where a helper returns an empty string.

## Layout and responsive

- **Shell:** a sidebar (`#nav`, grouped by `work`, `factory`, `claude`) and `main` (`ui/index.html:19`); the sidebar collapses to 48px on desktop (`ui/app.css:574`) and its state is kept in `localStorage`.
- **Page:** `.page` is at most 2400px wide with `28px 24px 64px` padding, `20px 16px 48px` at 720px and below (`ui/app.css:189`, `ui/app.css:532`).
- **Skeleton:** `pageHead()` (`ui/lib.js:289`) with the serif title and a muted count, then `card()` sections with a `sectionHead()`; Status has its own `.shead`. A detail page starts with `crumb()` (`ui/lib.js:331`).
- **Grid:** `.tiles` is an auto-fit grid of 150px minimum; `.lanes` is 3 columns, 2 at 1100px and below, 1 at 720px and below.
- **Phone:** at 720px and below, 11 rules change the layout; tables scroll inside `.tscroll`. What each table does at a phone width was not seen in a browser.

## Accessibility

Contrast ratios, computed from the hex values in `ui/app.css` (text on its background; 4.5:1 is the minimum):

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--surface` | 13.64 | 12.07 |
| `--ink-2` on `--surface` | 8.02 | 8.02 |
| `--muted` on `--surface` | 5.43 | 4.69 |
| `--muted` on `--bg` | 4.93 | 5.36 |
| `--muted` on `--sunk` | 4.57 | 5.83 |
| `--need` on `--need-bg` | 5.13 | 6.50 |
| `--stuck` on `--stuck-bg` | 4.78 | 4.54 |
| `--done` on `--done-bg` | 5.17 | 5.36 |
| `--run` on `--run-bg` | 4.99 | 4.61 |
| `--hot` on `--surface` | 4.65 | 5.80 |
| `--focus` on `--surface` (ring, 3:1 for a non-text mark) | 5.21 | 5.67 |
| white on `--seg-restarted` (the lowest of the five) | 4.70 | 4.70 |

All pairs listed pass 4.5:1. `ui/stuck-contrast.test.ts` tests the stuck pair. A state is shown by a text badge as well as colour, but a bar's tone and the diff colours rely on colour. The focus ring is visible on all controls. Motion stops under `prefers-reduced-motion`. Sort headers set `aria-sort` (`ui/lib.js:496`) and selector tiles set `aria-pressed` (`ui/lib.js:433`).

## Components

Reference view = the view that follows the rules best.

| Component | Helper | Reference view |
|---|---|---|
| Page header | `pageHead()` | `ui/views/jobs.js` |
| Card | `card()` | `ui/views/factory-agents.js` |
| Table | `dataTable()`, `sortHead()` | `ui/views/jobs.js:96` |
| Badge | `badge()` | `ui/views/jobs.js` |
| Chip | `chips()` | `ui/views/issues.js` |
| Button | `.act`, `.cmd` | `ui/views/issues.js` |
| Chart | `chart()`, `barsOption()`, `lineOption()` | `ui/views/factory-agents.js` |
| Metric tile | `tile()` | `ui/views/factory-agents.js:19` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `ui/views/issues.js:241` |
| Empty state | `empty()` | `ui/views/jobs.js:87` |

These references were chosen by reading the code, not by looking at the pages. Gap: no view is a reference for a chart's empty or loading state.

## Rules

Use:

- a colour token from `ui/app.css` for every colour, and `readTokens()` for a chart;
- `--fs-xs`, `--fs-sm`, `--fs-md`, `--fs-lg` for font sizes, and `--r-card`, `--r-ctl`, `--r-tag` for radii;
- `when()`, `day()`, `hourLabel()`, `clock()`, `dur()`, `durMs()`, `money()`, `count()`, `pct()` for times, durations, costs, counts and percents;
- `dataTable()` with `heads()` or `sortHead()` for a table, `empty()` for an empty state, and `badge()` for a state;
- the column order id or name, title, state, project, labels, numbers, time;
- the spacing steps, `opacity: .6` for a dimmed control, 28px for a control and 10px for a bar, as listed under Tokens, until their tokens land.

Never hard-code: a hex colour or shadow in CSS or in a view, a font size, radius or `z-index` in a literal, a breakpoint other than 720px and one wide width, or a date, number or duration format written inline.

## Deviations

The audit of 2026-11-04 marks every inventory row and lists each deviation with its `file:line`: `docs/findings/2026-11-04-ui-design-audit.md`. The fixes of 2026-11-03 are in `docs/findings/2026-11-03-ui-design-fixes.md`; items 1 to 6 are on main.
