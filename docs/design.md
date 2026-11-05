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
- **Browser checks.** Chrome could not start in the sandbox of the run that wrote this page, so no page was rendered, in light or dark, at desktop or phone width. Responsive behaviour below is read from the media queries; chart empty and loading states, and whether a table scrolls or wraps at a phone width, are read from the code and not seen.
- **Colour token uses.** The inventory has no `token-use` kind for colours: `var(--ink)` and the like are not counted, so a colour token has a definition count (three blocks) and no use count.
- **Contrast.** Computed from the hex values in `ui/app.css` for the pairs below, not for every text and background pair that the CSS puts together. The pair `--muted` on `--rule-2` (4.41 light, 4.35 dark) was not traced to a use.
- **Inventory false positives.** `ui/views/efficiency.js:88` is read as the colour literal `#eff`, but the line is `root.querySelector("#eff")`, an element id selector, not a colour. The inventory reads text, so it counts it in the colour literals.
- **Chart data.** No chart was drawn with real data.

## Principles

1. **One token set, two themes.** Colours are CSS custom properties on `:root` (`ui/app.css:3`), re-set for dark in two identical blocks, the `prefers-color-scheme` one at `ui/app.css:87` and the `data-theme="dark"` one at `ui/app.css:119`. Light is a lavender match for Palenight; dark is Palenight (Mild Contrast).
2. **Shared helpers build the parts.** Views call `ui/lib.js` for a page head, card, table, badge, chip, filter bar, pager, metric card and bar list, and the CSS for them is in `ui/app.css`.
3. **Meaning is a tone.** A state is `run`, `done`, `need`, `stuck` or `quiet`, mapped by `tone()` in `ui/lib.js:282`, and the same tone colours a badge, a chart series and a metric card.
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
| `--raised` | #ECEAF6 | #32374D | a selected metric card |
| `--approve`, `--decide`, `--unstick` | see `ui/app.css:30-32` | see `ui/app.css:112-114` | the three Ask cards, each with `-bg` and `-ring` |
| `--seg-landed`, `-fixed`, `-nothing`, `-restarted`, `-dropped` | `ui/app.css:35` | same in both themes (not re-set in dark) | Efficiency outcome bar, under white text |
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #1BAF7A, #EDA100, #E87BA4 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #C792EA, #89DDFF | extra chart series |
| `--lift` | `0 1px 3px` and `0 2px 8px` shadows | heavier black shadows | the top Status card |

Type, size and effect tokens (`ui/app.css:47-55`):

| Token | Value | Role |
|---|---|---|
| `--fs-2xs` | 11px | badges and ids on narrow cards, bar labels |
| `--fs-xs` | 12px | table headers, meta, badges |
| `--fs-sm` | 13px | table cells, secondary text |
| `--fs-md` | 14px | body |
| `--fs-lg` | 15px | section headings |
| `--fs-2xl` | 20px | brand mark, detail figure, the second value on a metric card |
| `--fs-xl` | 26px | page title, in `--display` |
| `--fs-metric` | 32px | the value on a metric card |
| `--fw-text` | 400 | text |
| `--fw-mid` | 500 | ids and numbers |
| `--fw-strong` | 600 | headings and table headers |
| `--r-card` | 10px | cards, metric cards |
| `--r-ctl` | 6px | controls |
| `--r-tag` | 4px | badges, code blocks |
| `--r-hair` | 2px | bars, marks, thin rules |
| `--r-pill` | 999px | chips, pills |
| `--sp-2` | 2px | `gap`, `padding`, `margin` |
| `--sp-4` | 4px | `gap`, `padding`, `margin` |
| `--sp-6` | 6px | `gap`, `padding`, `margin` |
| `--sp-8` | 8px | `gap`, `padding`, `margin` |
| `--sp-10` | 10px | `gap`, `padding`, `margin` |
| `--sp-12` | 12px | `gap`, `padding`, `margin` |
| `--sp-16` | 16px | `gap`, `padding`, `margin` |
| `--z-rowlink` | 1 | `tr.rowlink` links above the row link |
| `--z-sticky` | 2 | sticky bar, waterfall axis |
| `--z-overlay` | 50 | font picker |
| `--gap-in` | 16px | between metric cards and side-by-side cards |
| `--gap` | 24px | between page blocks |
| `--sans`, `--mono`, `--num`, `--display`, `--metric`, `--brand` | Work Sans, Hack Nerd Font, Merriweather families | body, code, numbers, titles |

Weights are tokens: `--fw-text` 400 for text, `--fw-mid` 500 for ids and numbers, `--fw-strong` 600 for headings and table headers. 700 stays a literal on `.mark` and `.tile b`.

Breakpoints are not tokens, because custom properties do not work in `@media`. There are two named widths: 720px and 1100px (wide). The queries in `ui/app.css` are `(max-width: 720px)` 10 times, `(max-width: 1100px)` 3 and `(min-width: 721px)` 1.

Spacing is tokens: `--sp-2`, `--sp-4`, `--sp-6`, `--sp-8`, `--sp-10`, `--sp-12` and `--sp-16` are 2, 4, 6, 8, 10, 12 and 16px, used for every `gap`, `padding` and `margin` on that scale. A negative margin is written `calc(-1 * var(--sp-2))`. Widths and heights stay literal.

Radii: the five `--r-*` tokens. Shadows: `--lift`, plus `box-shadow: inset` rings for selected and parked states. Layers: `z-index` is tokens, `--z-rowlink` < `--z-sticky` < `--z-overlay`. Motion: 2 `transition` literals (`.15s ease-out`), one `pulse` animation switched off under `prefers-reduced-motion` (`ui/app.css:414`).

Rules taken from the audit of 2026-11-04 (`docs/findings/2026-11-04-ui-design-audit.md`). Each pattern has 3 or more uses and no token yet. Until its token lands, use the value given here.

| Rule | Value | Uses | Token to come |
|---|---|---|---|
| Dimmed control | `opacity: .6` | 3 (`ui/app.css:322`, `343`, `963`) | `--dim` |
| Display type tracking | `letter-spacing: -0.01em` on the brand mark, page title and display text | 4 (`ui/app.css:165`, `190`, `191`, `479`) | none; a rule |
| Small-caps key tracking | one value for uppercase keys; today `.06em` (`ui/app.css:564`) and `.08em` (`ui/app.css:722`) | 2 | none; pick one when a third key comes |
| Control height | 28px | 9 (`min-height` 6, `height` 3) | `--ctl-h` |
| Bar and meter height | 10px | 8 | `--bar-h` |

## Formats

One format per kind of value. The helpers are in `ui/lib.js` unless named.

| Kind | Format | Example | Helper | Missing |
|---|---|---|---|---|
| Absolute time | mm/dd hh:mm, 24-hour; `YYYY-MM-DD` in another year | 10/28 14:05 | `when()` (`ui/lib.js:298`) | empty string |
| Day | month name and day; `YYYY-MM-DD` in another year | Oct 28 | `day()` (`ui/lib.js:313`), `dateText()` (`ui/views/issues.js:206`) | empty string |
| Axis hour | 12-hour, `a` or `p` | 4a, 1:36p | `hourLabel()` (`ui/lib.js:307`), for a chart axis only | none |
| Clock | 24-hour time | 14:05 | `clock()` | empty string |
| Duration | seconds, minutes, hours; `durMs()` writes `850ms` under a second; `span()` in `ui/views/now.js` writes `2d4h` from 24 hours, a form `dur()` has no day for | 43s, 4m 05s, 1h 02m, 850ms | `dur()`, `durMs()`, `span()`, `elapsed()`; `lifespan()` (`ui/timeline.js:10`) for the timeline | `–` from `dur()`, empty from `durMs()` |
| Cost | dollars, 2 decimals, `<$0.01` under half a cent | $1.25 | `money()` (`ui/lib.js:18`), also for the Runs today cost | `$0.00` |
| Weekly share | `≈1.4% wk` | ≈1.4% wk | `wkText()` (`ui/lib.js:30`), `costHtml()` | empty string |
| Percent | whole number from 1%, one decimal below, `<0.1%` under 0.05% | 12%, 0.4% | `pct()` (`ui/lib.js:29`) | `–` |
| Count | thousands separators | 12,345 | `count()` (`ui/lib.js:19`) | none |
| Ids | mono, muted, `500 var(--fs-xs)` | aleph-52 | `idLink()`, `repoIdLink()` | none |
| Model | name without `claude-` and the version | opus | `shortModel()` | empty string |
| Bytes | `B`, `KiB`, `MiB`, one decimal | 1.5KiB | `bytes()` (`ui/lib.js:25`) | none |
| Mean | one decimal | 2.4 | `mean()` (`ui/lib.js:21`) | `–` |
| Hours | one decimal under 10, whole from 10, then `h` | 3.2h, 12h | `hours()` (`ui/lib.js:23`) | none |
| Countdown | `m:ss` | 4:05 | `elapsed()`, ticked by `ui/index.html:221` | `0:00` |

**A unit follows its number with no space**: `850ms`, `3.2h`, `1.5KiB`, `12min`, `10d`. `dur()` puts a space only between two groups (`4m 05s`). Server log lines and health text from the factory keep their own form (`135 s`); they are not UI formats.

Every absolute time goes through `when()`; a chart axis uses `day()` or `hourLabel()` (`xLabel()`, `ui/views/speed.js:23`). The `format` group has 71 `helper-bypass` rows (`bun skills/design-language/scripts/inventory.ts ui | grep helper-bypass`). None builds a displayed date, number or duration by hand outside `ui/lib.js`. Each stays for one of these reasons:

| Rows | Reason it stays |
|---|---|
| `ui/lib.js` (`pad`, `clock`, `money`, `count`, `mean`, `hours`, `bytes`, `pct`, `dur`, `durMs`, `when`, `hourLabel`, `day`, the bar row) | The helpers themselves. |
| `ui/api/activity.ts:20`, `ui/api/speed.ts:387-388` | Local-day date arithmetic for bucket starts, not display. |
| `ui/views/issues.js:167`, `255`, `288`, `291`, `302` | Local-day date arithmetic for windows and age bins, not display. |
| `ui/views/jobs.js:11` | Rounds a window length to a stable number, not display. |
| `ui/views/memory.js:198`, `236`, `ui/views/sessions.js:74`, `ui/views/session.js:148`, `ui/timeline.js:138`, `ui/lib.js` bar row | Inline style widths and offsets in percent, read by CSS only. |
| `ui/api/skills.ts:92` | A server log line. |

## Tables

The one table is `dataTable()` (`ui/lib.js:480`) with `heads()` or `sortHead()` (`ui/lib.js:496`), styled by `table.tbl` (`ui/app.css:438`). Every table goes through `dataTable()`.

Rules, as the code states them (`ui/lib.js:289`, `ui/app.css:438`):

- **Column order:** id or name, title, state badge, project, labels, numbers, time last.
- **Spare width:** the widest text column is `td.wide`; it is cut with an ellipsis (`max-width: 0`, `overflow: hidden`).
- **Alignment:** text left; numbers right with `th.num` and `td.num`, in `--num` with tabular figures and weight 500.
- **Cells:** `white-space: nowrap`, padding `6px 12px 6px 0`, a `--rule-2` line under each row, and `--sunk` on row hover. Headers are `600 var(--fs-xs)` in `--muted`.
- **Sort:** a header button with `data-sort`; the sorted header is `--ink` with `aria-sort`, and the arrow is `▲` or `▼`.
- **Pager:** `pager()` shows "50 of 345" and "Show 50 more"; `PAGE` is 50 in `ui/views/issues.js:56` and `ui/views/jobs.js:44`.
- **Long text:** a long text cell clamps to 3 lines with `.dp-txt.clamp` and shows the rest on click.
- **Page length:** a table paginates at 50 rows with `pager()`.
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
| Job checks | Check, Result, Ran (num), Passed (num), Failed (num), Skipped (num), Time (num), Log; then each failed test with its failure | `ui/views/jobs.js:240` |
| Commits | Commit, Subject, Part, Date | `ui/views/issues.js:617` |

Gaps: the time column is `Started`, `Updated`, `Last`, `When`, `Date` or `Written` depending on the table, and a missing cell is empty in some tables and `–` in others. Row height is set by padding, not by a value. Row actions sit in the last column in the Issues table (`act`) and are absent elsewhere. Expansion is by `<details>` in lists, not in tables. Filters are a `.fbar` over the table.

## Charts and data displays

Charts are ECharts, themed by `chartTheme()` and drawn by `chart()` (`ui/lib.js:159`, `ui/lib.js:184`); the theme reads the page tokens through `readTokens()` (`ui/lib.js:174`) and redraws on a colour-scheme change.

- **Series colours:** `--run`, `--done`, `--need`, `--stuck`, then `--chart-6` and `--chart-7`; agent roles use `--series-1` to `--series-5`.
- **Bars:** `barsOption()` (`ui/lib.js:480`) for counts over categories, with no animation, `barMaxWidth: 64` and a shadow-pointer tooltip. Uses: `ui/views/factory-agents.js:33`.
- **Lines:** `lineOption()` (`ui/lib.js:480`) for one series over time, filled at 15% opacity, or as a step area (85%) for live counts. Uses: `ui/views/factory-agents.js:36`, `ui/views/factory-agents.js:48`.
- **Stacked areas:** `stackedAreaOption()` (`ui/lib.js`) for a count split by a category over time; one series per category, stacked, at 60% opacity, with a legend. Use: the open backlog by priority in `ui/views/issues.js`.
- **Range bars:** `rangeBarOption()` (`ui/lib.js`) for a spread per category: a horizontal bar to the p50 and a tick at the p90, one row per category. Use: time to close by kind in `ui/views/issues.js`.
- **Gap lines:** `gapLinesOption()` (`ui/lib.js`) for two counts over time: two lines, with the area between them shaded by a `custom` series. Use: filed and closed per day in `ui/views/issues.js`.
- **Jobs page:** three charts of the same height in one row (`trendOption`, `stripOption`, `slowestOption` in `ui/views/factory-jobs.js`), drawn by `chart()` with the theme tokens: a p50 and p90 line per bucket, a log-time strip with one dot per issue linking to the issue, and the 10 slowest issues as stacked bars of intake, queue, build and land. Each chart box has `role="img"` and an `aria-label` that states its data.
- **Axes:** category x axis, value y axis from 0 with whole-number steps. The x label is `xLabel()` (`ui/views/speed.js:23`): `4a` or `1:36p` in the hour and day windows, `Oct 25` in week and month.
- **Bar lists:** `barRow()` and `barList()` (`ui/lib.js:480`): label, bar, value on one grid.
- **Badges and chips:** `badge()` and `priorityBadge()` (`ui/lib.js:341`, `ui/lib.js:345`) are squared with `--r-tag`; `chips()` (`ui/lib.js:351`) are pills.
- **Efficiency bar:** `.obar`, in the five `--seg-*` colours under white text.
- **Loading and empty:** a chart's loading line is `<p role="status">Loading…</p>` (`ui/views/factory-agents.js:54`). Units and legends are not set in one place; each option names its series.

## Metric cards

A metric card is the standard data card. The Status scorecard set the design; every page with metric cards uses it. `statCard()` (`ui/lib.js`) draws one card, `tiles()` lays the cards out as an auto-fit grid of 150px minimum that stretches to fill the row, and the CSS is `.tile` in `ui/app.css`. Do not write card markup by hand.

A card has 3 rows and nothing else:

| Row | Content | Style |
|---|---|---|
| 1 | The key, left; the trend, right | Key: `--fs-xs`, `--fw-strong`, `--muted`, uppercase, `.08em` letter spacing. Trend: `--fs-sm`, `--fw-strong` |
| 2 | The value; then the second value as ` / v2` | Value: 700 `--fs-metric` (32px) in `--metric`, tabular numbers, `--ink`. Second value: 400 `--fs-2xl` (20px), `--muted`, not italic |
| 3 | A qualifier that names the two values (`p50 / p90`), or a note | `--fs-xs`, one line, cut with an ellipsis; the note's full text is its tooltip. Qualifier: the first name `--ink`, ` / second` `--muted`. Note: `--muted` |

- **Values:** text, made with the format helpers (`pct()`, `dur()`, `money()`, `count()`). An unknown value is `–`. The second value and the qualifier go together: a card with `v2` has `q` naming both values, unless the key already names them.
- **Trend:** `cardTrend()` (`ui/lib.js`) only. `▲` or `▼` and the change from `pct()`, or `▬ 0%` for no change. `kind: "points"` compares shares in percentage points; `"relative"` compares times and counts by relative change. The tone is `good` (`--good`) or `warn` (`--need`) from `lowerIsGood`. A count that is neither good nor bad (`lowerIsGood: null`) stays `--muted`. The tooltip gives the previous value and the baseline, or a `tip` that says what the trend compares. No trend when there is no baseline.
- **Bar:** an optional bar (`extra`) between rows 2 and 3, as on the Usage card (`.usebar`, 10px).
- **Link or selector:** with `href` the card is a link to the page that explains the number; with `key` it is a button that selects the detail below the cards (`data-tile`, `aria-pressed`, `onTile()`). Hover sets a `--run` border; a selected card is `--raised` with a `--run` border. The key has no arrow.
- **Box:** `--surface`, a 1px `--rule` border, `--r-card`, `--sp-12` by 14px padding, a `--sp-4` gap between rows; `--gap-in` between cards.
- **Window:** the page head states the window (`pageHead(..., { count })`), so a card does not repeat it.
- **More than 3 rows:** what does not fit goes in the card or chart below the cards, not in the card.

Uses: Status, Efficiency, Jobs, Agents, Automation, Issues, Memory, Sessions.

## Interaction

- **Focus:** one ring for all, `2px solid var(--focus)` with a 2px offset (`ui/app.css:162`). Segmented buttons, rows and the Ask head use a negative offset (`ui/app.css:496`, `ui/app.css:671`, `ui/app.css:996`).
- **Hover:** a link or button darkens its border to `--ink-2` (`.act`, `.cmd`, cards) or its text to `--ink` (crumbs, `a.idl`, sort buttons); a table row and a nav item take `--sunk`; a metric card takes a `--run` border.
- **Pressed:** a selector (metric card, segmented button, bar row) sets `aria-pressed="true"`, drawn with `--raised`, `--rule-2` or `--sunk`.
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

- **Headers:** sentence case for page and section titles (`Efficiency`, `Uses per day`); table headers in sentence case (`First prompt`); metric card keys are uppercased by CSS (`text-transform: uppercase`, 2 uses).
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
- **Grid:** `.tiles` holds the metric cards (see Metric cards); `.lanes` is 3 columns, 2 at 1100px and below, 1 at 720px and below.
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

All pairs listed pass 4.5:1. `ui/stuck-contrast.test.ts` tests the stuck pair. A state is shown by a text badge as well as colour, but a bar's tone and the diff colours rely on colour. The focus ring is visible on all controls. Motion stops under `prefers-reduced-motion`. Sort headers set `aria-sort` (`ui/lib.js:496`) and selector cards set `aria-pressed` (`statCard()` in `ui/lib.js`).

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
| Metric card (the standard data card) | `statCard()`, `cardTrend()`, `tiles()` | `ui/views/speed.js` `statusCards()` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `ui/views/issues.js:241` |
| Empty state | `empty()` | `ui/views/jobs.js:87` |

Cards with their own markup, because `card()` would add a heading or change the element:

- Memory browse table (`#mem-table`) and inspector (`#mem-inspector`): the table card has no heading, and the inspector is an `aside` with `aria-live`.
- Sessions (`ui/views/sessions.js`): its head is the redrawn `#ag-sess-head`, not a section head.
- Issues (`ui/views/issues.js`): the section has no heading; `#inv-count` is its head.
- Stages and Holds (`ui/views/now.js`): the sections hold the monitor tables from `monitor.stages` and `monitor.holds`, at most 10 rows each, drawn by `renderStages()` and `renderHolds()`.

These references were chosen by reading the code, not by looking at the pages. Gap: no view is a reference for a chart's empty or loading state.

## Rules

Use:

- a colour token from `ui/app.css` for every colour, and `readTokens()` for a chart;
- `--fs-xs`, `--fs-sm`, `--fs-md`, `--fs-lg` for font sizes, and `--r-card`, `--r-ctl`, `--r-tag` for radii;
- `when()`, `day()`, `hourLabel()`, `clock()`, `dur()`, `durMs()`, `money()`, `count()`, `pct()` for times, durations, costs, counts and percents;
- `dataTable()` with `heads()` or `sortHead()` for a table, `empty()` for an empty state, and `badge()` for a state;
- the column order id or name, title, state, project, labels, numbers, time;
- `--sp-*` for `gap`, `padding` and `margin`, and, until their tokens land, `opacity: .6` for a dimmed control, 28px for a control and 10px for a bar, as listed under Tokens.

Never hard-code: a hex colour or shadow in CSS or in a view, a font size, radius or `z-index` in a literal, a breakpoint other than 720px and one wide width, or a date, number or duration format written inline.

## Deviations

The audit of 2026-11-04 marks every inventory row and lists each deviation with its `file:line`: `docs/findings/2026-11-04-ui-design-audit.md`. The fixes of 2026-11-03 are in `docs/findings/2026-11-03-ui-design-fixes.md`; items 1 to 6 are on main.
