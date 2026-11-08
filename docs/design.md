# UI design reference

The design language of the aleph UI (`ui/`), read from the code by the design-language skill (`skills/design-language/SKILL.md`, Extract mode). It records what the code already mostly does. A value that bypasses it is a deviation, listed at the end with its fix. A deviation whose fix is an open issue names that issue as pending.

Counts come from `bun skills/design-language/scripts/inventory.ts ui --summary` on the tree this page describes. A count that the inventory does not print is a grep count, and the text says so. Totals:

| group | kind | count |
|---|---|---|
| colour | literal | 5 |
| colour | token-def | 98 |
| effect | literal | 46 |
| effect | token-use | 10 |
| format | helper-bypass | 64 |
| size | literal | 138 |
| size | token-def | 18 |
| size | token-use | 478 |
| type | literal | 26 |
| type | token-def | 31 |
| type | token-use | 44 |

## What could not be determined

- **Earlier decisions.** Absolute time is `10/28 14:05` (mm/dd hh:mm, 24-hour), the same format as the aleph-199 decision. A chart axis can keep a short form. No other UI decision outranks the code here.
- **Browser checks.** No page was rendered for this refresh, in light or dark, at desktop or phone width. Responsive behaviour below is read from the media queries. Chart empty and loading states, and whether a table scrolls or wraps at a phone width, are read from the code and not seen.
- **Colour token uses.** The inventory has no `token-use` kind for colours: `var(--ink)` and the like are not counted, so a colour token has a definition count (three blocks) and no use count.
- **Contrast.** Computed from the hex values in `ui/app.css` for the pairs below, not for every text and background pair that the CSS puts together. The pair `--muted` on `--rule-2` (4.41 light, 4.35 dark) was not traced to a use.
- **Inventory false positives.** None on this tree. `querySelector("#eff")` in `ui/views/efficiency.js` is no longer read as a colour literal.
- **Chart data.** No chart was drawn with real data.

## Principles

1. **One token set, two themes.** Colours are CSS custom properties on `:root` in `ui/app.css`, re-set for dark in two identical blocks, the `@media (prefers-color-scheme: dark)` one and the `:root[data-theme="dark"]` one. Light is a lavender match for Palenight; dark is Palenight (Mild Contrast).
2. **Shared helpers build the parts.** Views call `ui/lib.js` for a page head, card, table, badge, chip, filter bar, pager, metric card, meter and bar list. The CSS for them is in `ui/app.css`.
3. **Meaning is a tone.** A state is `run`, `done`, `need`, `stuck` or `quiet`, mapped by `tone()` in `ui/lib.js`. The same tone colours a badge, a chart series and a metric card.
4. **Numbers are tabular.** `font-variant-numeric: tabular-nums` has 12 literal uses, and number columns are right-aligned.
5. **Plain text states.** An empty state is one sentence and one hint, a missing value is `–`, and sentences end with a full stop.

## Tokens

All colour tokens are defined in three blocks of `ui/app.css`: light (`:root`), dark by media query, and dark by `data-theme`. That is the 98 colour `token-def` rows. Light and dark values are in the `:root` block of `ui/app.css`, the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme="dark"]` block.

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
| `--approve`, `--decide`, `--unstick` | see `--approve` in `ui/app.css` | the same in the dark block | the three Ask cards, each with `-bg` and `-ring` |
| `--seg-landed`, `-returned`, `-failed`, `-reran`, `-dropped` | `--seg-landed` in `ui/app.css` | same in both themes (not re-set in dark) | Efficiency outcome bar, under white text |
| `--fill-run`, `--fill-stuck`, `--fill-done`, `--fill-aux` | `--fill-run` in `ui/app.css` | same in both themes (not re-set in dark) | Timeline bar fills (`.dp-bar`), under white text |
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #1BAF7A, #EDA100, #E87BA4 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #C792EA, #89DDFF | extra chart series |
| `--lift` | `0 1px 3px` and `0 2px 8px` shadows | heavier black shadows | the top Status card |

The allowed colour literals outside the token blocks are the `#000` mask gradients of `.chat .clamp` and `.wf-detail .clamp` in `ui/app.css`, and the `color-mix(in srgb, currentColor 30%, transparent)` of `.cmd .cp` in `ui/app.css`.

Type, size and effect tokens (`ui/app.css`):

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
| `--sp-14` | 14px | `gap`, `padding`, `margin` |
| `--sp-16` | 16px | `gap`, `padding`, `margin` |
| `--sp-18` | 18px | `gap`, `padding`, `margin` |
| `--sp-20` | 20px | `gap`, `padding`, `margin` |
| `--sp-24` | 24px | `gap`, `padding`, `margin` |
| `--sp-28` | 28px | `gap`, `padding`, `margin` |
| `--dim` | .6 | `opacity` of a dimmed control |
| `--ctl-h` | 28px | `height` and `min-height` of a control |
| `--bar-h` | 10px | `height` of `.meter` and `.wf-bar` |
| `--z-rowlink` | 1 | `tr.rowlink` links above the row link |
| `--z-sticky` | 2 | sticky bar, waterfall axis |
| `--z-overlay` | 50 | font picker |
| `--gap-in` | 16px | between metric cards and side-by-side cards |
| `--gap` | 24px | between page blocks |
| `--indent-list` | 18px | `padding-left` of an indented list |
| `--sans`, `--mono`, `--num`, `--display`, `--metric`, `--brand` | Work Sans, Hack Nerd Font, Merriweather families | body, code, numbers, titles |

Weights are tokens: `--fw-text` 400 for text, `--fw-mid` 500 for ids and numbers, `--fw-strong` 600 for headings and table headers. 700 stays a literal on `.mark` and `.tile b` in `ui/app.css`.

Breakpoints are not tokens, because custom properties do not work in `@media`. There are two named widths: 720px and 1100px (wide). The queries in `ui/app.css` are `(max-width: 720px)` 11 times, `(max-width: 1100px)` 4 and `(min-width: 721px)` 1.

Spacing is tokens: `--sp-2`, `--sp-4`, `--sp-6`, `--sp-8`, `--sp-10`, `--sp-12`, `--sp-14`, `--sp-16`, `--sp-18`, `--sp-20`, `--sp-24` and `--sp-28` are 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24 and 28px, used for every `gap`, `padding` and `margin` on that scale. A negative margin is written `calc(-1 * var(--sp-2))`.  List indent is the token `--indent-list` (18px), used for every indented list. Widths and heights stay literal.

Radii: the five `--r-*` tokens. Shadows: `--lift`, plus `box-shadow: inset` rings for selected and parked states. Layers: `z-index` is tokens, `--z-rowlink` < `--z-sticky` < `--z-overlay`. Motion: 2 `transition` literals (`.15s ease-out`) and no CSS animation. The ECharts options set `animation: false` (8 rows).

### Missing tokens

These values repeat in the code with no token. Until a token lands, write the value given here.

| Proposed token | Value | Uses | Where |
|---|---|---|---|
| `--ls-display` | `letter-spacing: -0.01em` | 4 rows | `.mark`, `.shead .say`, `.shead .asof` and `.ph h1` in `ui/app.css` |
| `--ls-caps` | one tracking for uppercase keys | 2 rows (`.06em`, `.08em`) | `#nav li.head` and `.tile .k` in `ui/app.css` |

## Patterns

Each pattern below has 3 or more uses in the code, or is a fixed part of a component. Where the code uses another value, the row is a deviation, listed at the end.

| Rule | Value | Uses | Token to come |
|---|---|---|---|
| Display type tracking | `letter-spacing: -0.01em` on the brand mark, the shead text, the page title and display text | 4 rows (`.mark`, `.shead .say`, `.shead .asof` and `.ph h1` in `ui/app.css`) | `--ls-display` |
| Small-caps key tracking | one value for uppercase keys; today `.06em` in `#nav li.head` and `.08em` in `.tile .k`, both in `ui/app.css` | 2 rows | none; pick one when a third key comes |
| Focus offset | `outline-offset: 2px` outside a control; `-2px` inside a container (segmented control, row, Ask head) | 2 and 5 rows (grep of `ui/app.css`) | none; a rule |
| Chart gridline | `opacity: 0.5` on `splitLine` | 4 rows (`splitLine` in `ui/chart.js`) | none; a rule |
| Line height | a unitless multiplier, in `line-height` or the `font:` shorthand (`1.35`, `1.45`, `1.55`) | 15 `line-height` rows, 0 in px (grep of `ui/app.css` and `ui/index.html`) | none; a rule |

### Focus offset

- A control takes `outline: 2px solid var(--focus)` with `outline-offset: 2px` (`:focus-visible` in `ui/app.css`).
- A control inside a container takes `outline-offset: -2px`, so the ring sits inside the box (`.seg button:focus-visible`, `.wf-row:focus-visible` and `.ask-head:focus-visible` in `ui/app.css`).

### Chart gridlines and fills

- Gridlines are `splitLine` at `opacity: 0.5`.
- A stacked area series is filled at `areaStyle: { opacity: 0.6 }` in `ui/chart.js`, with a legend.

### Row actions

- No table has a row action column. The inventory of tables (see Tables) has no action column.
- A row's actions sit in a `.actions` box under the row's text, in the same card: `ui/views/jobs.js` and `ui/views/now.js`.
- A table cell holds data only.

### Key-value pairs and fact lists

- There are no key-value tables. A key and a value in a card or panel is a fact list: `<dl class="facts">` with one `<div>` per fact, `<dt>` for the key and `<dd>` for the value (`ui/views/memory.js`, `ui/views/session.js` and `ui/views/now.js`; 5 uses).
- The fact list is a flex row that wraps (`.facts` in `ui/app.css`). Its key is `--muted`; its value has `dd { margin: 0 }`.

### Form messages

- A result line after an action, or inside a form, is a `<span>` with the class `act-msg` (`.act-msg` in `ui/app.css`). `say()` in `ui/lib.js` writes the text and makes the line with `role="alert"` when there is none (callers: `ui/index.html`, `ui/views/gates.js`, `ui/views/issues.js` and `ui/views/session.js`). A line placed in markup keeps its role: `ui/views/cards.js` (alert) and `ui/views/issues.js` (status).

### Two-click confirm

- Land (on an action without a choice box), Drop and Pause ask for a second click. The first click turns the label into `<label> <name>? Click again` for 5 seconds, then the label returns (`ui/index.html`). The second click runs the action.
- A deny or answer that needs a reason opens the reason box on the first click, and its button reads `Confirm` (`ui/index.html`).

### Chart empty state

- A chart panel (`<aleph-chart>`, `ui/chart.js`) shows its title and its frame's empty line — `empty("Nothing to plot in this window.")` unless the frame names its own — when no key has a value. Every chart on the Agents, Jobs, Issues and Skills pages is a panel.
- A card with a chart shows `empty()` in place of the chart when the chart has no data: `ui/views/skills.js` (`This skill was not used in the window.`).

## Formats

One format per kind of value. The helpers are in `ui/lib.js` unless named.

| Kind | Format | Example | Helper | Missing |
|---|---|---|---|---|
| Absolute time | mm/dd hh:mm, 24-hour; `YYYY-MM-DD` in another year | 10/28 14:05 | `when()` in `ui/lib.js` | empty string |
| Day | month name and day; `YYYY-MM-DD` in another year | Oct 28 | `day()` in `ui/lib.js`, `dateText()` in `ui/views/issues.js` | empty string |
| Axis hour | 12-hour, `a` or `p` | 4a, 1:36p | `hourLabel()` in `ui/lib.js`, for a chart axis only | none |
| Clock | 24-hour time | 14:05 | `clock()` in `ui/lib.js` | empty string |
| Duration | seconds, minutes, hours, days; `durMs()` writes `850ms` under a second | 43s, 4m 05s, 1h 02m, 2d 04h, 850ms | `dur()` in `ui/lib.js`, `durMs()` in `ui/lib.js`, `span()` in `ui/lib.js` for two timestamps | `–` from `dur()`, empty from `durMs()` |
| Cost | dollars, 2 decimals, `<$0.01` under half a cent | $1.25 | `money()` in `ui/lib.js`, also for the Runs today cost | `$0.00` |
| Weekly share | `≈1.4% wk` | ≈1.4% wk | `wkText()` in `ui/lib.js`, `costHtml()` in `ui/lib.js` | empty string |
| Percent | whole number from 1%, one decimal below, `<0.1%` under 0.05% | 12%, 0.4% | `pct()` in `ui/lib.js` | `–` |
| Count | thousands separators | 12,345 | `count()` in `ui/lib.js` | none |
| Ids | mono, muted, `500 var(--fs-xs)`; forms in [Naming](naming.md) | a52 | `idLink()` in `ui/lib.js`, `repoIdLink()` in `ui/lib.js` | none |
| Model | name without `claude-` and the version | opus | `shortModel()` in `ui/lib.js` | empty string |
| Bytes | `B`, `KiB`, `MiB`, one decimal | 1.5KiB | `bytes()` in `ui/lib.js` | none |
| Mean | one decimal | 2.4 | `mean()` in `ui/lib.js` | `–` |
| Hours | one decimal under 10, whole from 10, then `h` | 3.2h, 12h | `hours()` in `ui/lib.js` | none |

**A unit follows its number with no space**: `850ms`, `3.2h`, `1.5KiB`, `12min`, `10d`. `dur()` puts a space only between two groups (`4m 05s`). Server log lines and health text from the factory keep their own form (`135 s`); they are not UI formats.

Every absolute time goes through `when()`; a chart axis uses `day()` or `hourLabel()` (`xLabel()` in `ui/views/speed.js`). The `format` group has 64 `helper-bypass` rows (`bun skills/design-language/scripts/inventory.ts ui | grep helper-bypass`). None builds a displayed date, number or duration by hand outside `ui/lib.js`, except the rows below. Each stays for one of these reasons:

| Rows | Reason it stays |
|---|---|
| `ui/lib.js` (31 rows: `pad`, `clock`, `money`, `count`, `mean`, `hours`, `bytes`, `pct`, `durMs`, `when`, `hourLabel`, `day`, the bar row) | The helpers themselves. |
| `ui/activity.ts`, `ui/api/speed.ts` | Local-day date arithmetic for bucket starts, not display. |
| `getDate()` in `ui/views/issues.js` | Local-day date arithmetic for windows and age bins, not display. |
| `toFixed()` in `ui/views/jobs.js` | Rounds a window length to a stable number, not display. |
| `style` in `ui/views/session.js` and `ui/timeline.js` | Inline style widths and offsets in percent, read by CSS only. |
| `ui/api/skills.ts` | A server log line. |
| `ui/views/memory.js` | A bar width in percent, read by CSS only. |

## Tables

The one table is `dataTable()` in `ui/lib.js` with `heads()` in `ui/lib.js` or `sortHead()` in `ui/lib.js`, styled by `table.tbl` in `ui/app.css`. A table that can pass 50 rows is `pagedTable()` in `ui/lib.js`, which wraps `dataTable()` and `pager()`. Every table goes through one of the two.

Rules, as the code states them (`table.tbl` in `ui/app.css`):

- **Column order:** time first, then id or name, title, state badge, project, labels, numbers. A duration is a number and stays among the numbers; its header is always `Took`.
- **Time column name:** one past-tense word for the event (`Started`, `Updated`, `Written`, `Committed`, `Logged`, `Denied`), or `Last` followed by the event (`Last Turn`, `Last Call`, `Last Run`) when a row stands for many events and shows the newest.
- **Spare width:** the widest text column is `td.wide` in `ui/app.css`; it is cut with an ellipsis (`max-width: 0`, `overflow: hidden`).
- **Alignment:** text left; numbers right with the `.num` class in `ui/app.css` on `th` and `td`, in `--num` with tabular figures and weight 500.
- **Cells:** `white-space: nowrap`, padding `--sp-6 --sp-12 --sp-6 0`, a `--rule-2` line under each row, and `--sunk` on row hover (`table.tbl` in `ui/app.css`). Headers are `600 var(--fs-xs)` in `--muted`.
- **Sort:** a header button with `data-sort`; the sorted header is `--ink` with `aria-sort`, and the arrow is `▲` or `▼` (`sortHead()` in `ui/lib.js`).
- **Pager:** `pager()` in `ui/lib.js` shows "50 of 345" and "Show 50 more"; `PAGE` is 50, set by `PAGE` in `ui/views/issues.js` and `PAGE` in `ui/views/jobs.js`.
- **Long text:** `clamp()` (`ui/lib.js`) sets long text clamped, followed by a button with `aria-expanded` that opens and closes it. A list that shows its first N rows uses `moreFold()` (`ui/lib.js`).
- **Wide tables:** `.tscroll` in `ui/app.css` scrolls sideways.
- **Empty table:** `empty()` in `ui/lib.js` in place of the table.

Columns of the main tables:

| Table | Columns, in order | Source |
|---|---|---|
| Issues | Updated, Id, Title, Stage, Project, Priority, Labels, Notes (num), Runs (num), Cost (num), Age (num) | `dataTable()` in `ui/views/issues.js` |
| Jobs | Started, Job, Title, State, Project, Model, Took (num), Cost (num) | `dataTable()` in `ui/views/jobs.js` |
| Sessions | Started, Last Turn, Session, First Prompt, Project, Kinds, Turns (num), Cost (num) | `dataTable()` in `ui/views/sessions.js` |
| Memory notes | Written, Title, Kind, Scope, Read, Status | `dataTable()` in `ui/views/memory.js` |
| Turns of a session | Started, Turn (num), Prompt, Output, Model, Tools (num), Took (num), Cost (num) | `dataTable()` in `ui/views/session.js` |
| Observations | Kind, Name, Detail, Took (num) | `dataTable()` in `ui/views/session.js` |
| Gates log | Logged, By, Subject, Action, Sub, Content, Times (num) | `dataTable()` (`ui/views/gates.js` `renderLog`) |
| Hooks | Last Call, Hook, Calls (num), Errors (num) | `dataTable()` in `ui/views/sessions.js` |
| Denials | Denied, Reason | `dataTable()` in `ui/views/sessions.js` |
| Efficiency | Issue, Why, Took (num), Runs (num); Issue, Usage (num), Runs (num) | `dataTable()` and `pagedTable()` in `ui/views/efficiency.js` |
| Agents by role | Role, Model, one number column per measure, Jobs | `dataTable()` in `ui/views/factory-agents.js` |
| Job checks | Check, Result, Ran (num), Passed (num), Failed (num), Skipped (num), Took (num), Log; then each failed test with its failure | `pagedTable()` in `ui/views/jobs.js` |
| Commits | Committed, Commit, Subject, Part | `pagedTable()` in `ui/views/issues.js` |

Gaps: a missing cell is empty in some tables and `–` in others. Row height is set by padding, not by a value. Expansion is by `<details>` in lists, not in tables. Filters are a `.fbar` in `ui/app.css` over the table.

## Charts and data displays

Charts are ECharts, themed by `chartTheme()` in `ui/lib.js` and drawn by `chart()` in `ui/lib.js`; the theme reads the page tokens through `readTokens()` in `ui/lib.js` and redraws on a colour-scheme change.

- **Series colours:** `--run`, `--done`, `--need`, `--stuck`, then `--chart-6` and `--chart-7`; agent roles use `--series-1` to `--series-5`.
- **Jobs page:** three chart panels in one row (`trendFrame`, `stripFrame`, `slowestFrame` in `ui/views/factory-jobs.js`), each from the stage tile selected: the p50 and the p90 of the stage per bucket as two lines, not stacked areas, with 0 for a bucket with no time; one point per issue by outcome, at its filing time, for its time in the stage (an issue with no filing time has no point); and the 10 slowest stages as bars coloured by stage, ordered by stage then by issue (for Lead Time an issue has a row per slow stage). Each panel keeps the line under its title that describes the stage, and its rows link to their issues.
- **Chart panel:** `<aleph-chart key="<view>/<chart>">` (`ui/chart.js`) draws a frame as a card that fills its grid cell. A frame names its measure (name, unit, `agg` of `sum` for a flow or `max` for a level), what it is over (time with the window, or a category) and its breakdown (`by`, keys with a colour token each). From the frame come the title (`<measure> by <dimension>`, as Agents Live by Role), the aria label (each key's total, or peak for a level), the axis and tooltip format of the unit, the series colours, the empty line, the line under the title and the form it opens in. The forms are a group's icon buttons in the card head: over time Area, Columns, Lines, Points and Share (a flow opens as Columns, a level as Area); over categories Stacked, Grouped and Share. A row with an `href` keeps its issue link on its point, and a category frame lists its linked rows under the chart for a reader who cannot click a bar. `push(row)` adds a row or replaces the row with the same `at` and keeps the window's length.
- **Issues page:** three chart panels (`backlogFrame`, `closeFrame`, `testsFrame` in `ui/views/issues.js`): Open Backlog, Filed and Closed over the window, one key per priority plus the filed and closed counts of the same buckets; Time to Close by kind, the p50 and the p90 in seconds with the unit in the line under the title; and Tests, one key per project for the tests of each suite run and for the tests that passed only on rerun. The backlog and Tests panels take two columns of the row.
- **Skills page:** one panel, Uses per Day (`usesFrame` in `ui/views/skills.js`), one row per day counted on from the API's `since`.
- **Agents page:** three chart panels in one row (`liveFrame`, `outcomesFrame`, `costFrame` in `ui/views/factory-agents.js`): Agents Live by Role, one key per timed role, coloured by its place in the fixed role list (`--series-1` to `--series-5`, `--chart-6`, `--chart-7`); Outcomes by Role, succeeded, failed and stuck in `--done`, `--need` and `--stuck`; and Cost by Model per bucket, from `buckets[].cost` in `/api/speed`.
- **Sticky state:** `keep(key, value)` and `kept(key, fallback)` (`ui/lib.js`) keep a JSON value in `localStorage` under `aleph.<key>`. The address holds what changes the data or what a link shares (the window, the project, a filter); `keep()` holds how a component shows it (a chart panel's form and hidden series). One key per component, never per row or item. The window and the project use it as their store.
- **Status layout:** the status line and the metric cards span the page. Under them, the main column holds Agent Time and Pipeline, and the Herald is a rail at the right (`clamp(480px, 38%, 600px)`), sticky and the viewport tall. Under 1100px the Herald goes under the main column. Status has no lanes: the Herald's Issues tab lists the running, queued and done work.
- **Herald:** the badge says `N active` in the tone of the worst alert (a stuck job or an error is `stuck`, an Ask alone is `need`), or `Calm`. The alert cards come first with no heading; with no alert there is no alert row, as the badge already says `Calm`. Then two tabs: Events (the status history) and Issues (Running pinned at the top, then Queued, then Done today, folded by default and quiet; its open state stays through `keep()`).
- **Alerts section (Status page):** the Herald holds the Asks and the stuck, failed and error cards. The cards are one full-width column, as the Asks are. Each card has the Ask card structure (`ask-box` with the meta row, then the fold, then the buttons); a stuck, failed or error card uses the red `unstick` tone. The id, priority, date and runtime sit inside the box and show while the fold is closed. The status line links `#awaiting` (Asks) and `#jobs-stuck` (stuck jobs) point at the two lists of the section.
- **Axes:** category x axis, value y axis from 0 with whole-number steps. The x label is `xLabel()` in `ui/views/speed.js`: `4a` or `1:36p` in the hour and day windows, `Oct 25` in week and month. The cost chart on Agents is the one exception (see Deviations).
- **Meters:** `meter()` in `ui/lib.js` draws every share bar, one share or segments, as `.meter` in `ui/app.css` (10px) with `role="img"` and an `aria-label`, or `aria-hidden` beside a visible value. Uses: bar lists, the Efficiency table, Status cells, Sessions tools, Memory recall and the Usage card.
- **Bar lists:** `barRow()` in `ui/lib.js` and `barList()` in `ui/lib.js`: label, meter, value on one grid.
- **Badges and chips:** `badge()` in `ui/lib.js` and `priorityBadge()` in `ui/lib.js` are squared with `--r-tag`; `chips()` in `ui/lib.js` are pills.
- **Agent Time bar:** `bar()` in `ui/views/speed.js`, on Status and Efficiency: `.obar`, 28px high, in the five `--seg-*` colours with no text on the bar. A legend (`.olegend`) under it names each outcome with its hours and share, as `landed (40h 57%)`.
- **Loading and empty:** a chart's loading line is `loadingLine()` in `ui/lib.js`, which returns `<p class="quiet" role="status">Loading <what>…</p>`; the Agents view calls it in `ui/views/factory-agents.js`. Units are not set in one place; the legend is one shared option (`legend` in `ui/lib.js`), and each option names its series.

## Metric cards

A metric card is the standard data card. The Status scorecard set the design; every page with metric cards uses it. `statCard()` in `ui/lib.js` draws one card, `tiles()` in `ui/lib.js` lays the cards out as an auto-fit grid of 150px minimum that stretches to fill the row, and the CSS is `.tile` in `ui/app.css`. Do not write card markup by hand.

A card has 3 rows and nothing else:

| Row | Content | Style |
|---|---|---|
| 1 | The key, left; the trend, right | Key: `--fs-xs`, `--fw-strong`, `--muted`, uppercase, `.08em` letter spacing (`.tile .k` in `ui/app.css`). Trend: `--fs-sm`, `--fw-strong` |
| 2 | The value; then the second value as ` / v2` | Value: 700 in `--metric`, tabular numbers, `--ink`, on one line that never wraps: the card is a size container and the value is `clamp(16px, 13cqi, --fs-metric)`, so it shrinks with the card's width. Second value: 400, 0.62 of the value's size (20px at full size), `--muted`, not italic |
| 3 | A qualifier that names the two values (`p50 / p90`), or a note | `--fs-xs`, one line, cut with an ellipsis; the note's full text is its tooltip. Qualifier: the first name `--ink`, ` / second` `--muted`, both in lower case (`all / manual`, not `All / Manual`); a proper name such as `Chris` keeps its capital. Note: `--muted` |

- **Values:** text, made with the format helpers (`pct()`, `dur()`, `money()`, `count()`). An unknown value is `–`. The second value and the qualifier go together: a card with `v2` has `q` naming both values, unless the key already names them.
- **Trend:** `cardTrend()` in `ui/lib.js` only. `▲` or `▼` and the change from `pct()`, or `▬ 0%` for no change. `kind: "points"` compares shares in percentage points; `"relative"` compares times and counts by relative change. The tone is `good` (`--good`) or `warn` (`--need`) from `lowerIsGood`. Each card states which direction is good. A neutral (`--muted`) trend (`lowerIsGood: null`) is only for a card where neither direction is good. The tooltip gives the previous value and the baseline, or a `tip` that says what the trend compares. No trend when there is no baseline.
- **Bar:** an optional bar (`extra`) between rows 2 and 3, as on the Usage card (`meter()` with a mark, 10px).
- **Link or selector:** with `href` the card is a link to the page that explains the number; with `key` it is a button that selects the detail below the cards (`data-tile`, `aria-pressed`, `onTile()`). Hover sets a `--run` border; a selected card is `--raised` with a `--run` border. The key has no arrow.
- **Box:** `--surface`, a 1px `--rule` border, `--r-card`, `--sp-12` by `--sp-14` padding, a `--sp-4` gap between rows; `--gap-in` between cards.
- **Window:** the page head states the window (`pageHead(..., { count })`), so a card does not repeat it.
- **More than 3 rows:** what does not fit goes in the card or chart below the cards, not in the card.

Uses: Status, Efficiency, Jobs, Agents, Automation, Issues, Memory, Sessions.

Exception: the KPI strip of a detail page (`renderKpis()` in `ui/timeline.js`) is not a metric card. It is a row of facts about one job or issue (text, links, spans), not numbers with a trend, so it has no trend, no qualifier and no `statCard()`.

The Roles table on Agents has one row per role and model ("Worker · haiku"). Its Success cell is the success rate with a `cardTrend()` marker (`kind: "points"`, against the baseline). A rate under 70% (`WARN_RATE` in `ui/views/factory-agents.js`) shows in the `--need` tone. The Jobs cell links to `#/factory/jobs?role=<role>&condition=failed`.

## Interaction

- **Focus:** one ring for all, `2px solid var(--focus)` with a 2px offset (`:focus-visible` in `ui/app.css`). Segmented buttons, rows and the Ask head use a negative offset (`.seg button:focus-visible`, `.wf-row:focus-visible` and `.ask-head:focus-visible` in `ui/app.css`). See Patterns.
- **Hover:** a link or button darkens its border to `--ink-2` (`.act:hover` and `.cmd:hover` in `ui/app.css`, cards) or its text to `--ink` (crumbs, `a.idl` in `ui/app.css`, sort buttons); a table row and a nav item take `--sunk` (`#nav a:hover` in `ui/app.css`); a metric card takes a `--run` border.
- **Pressed:** a selector (metric card, segmented button, bar row) sets `aria-pressed="true"`, drawn with `--raised`, `--rule-2` or `--sunk`.
- **Disabled:** `.act:disabled` in `ui/app.css` is 60% opacity with a wait cursor.
- **Active:** `.cmd:active` in `ui/app.css` moves 1px down.
- **Disclosure:** `<details>` for the fold in a list and for the Ask card (`.ask-fold` in `ui/app.css`); the open state of each is kept across a redraw by `recordState()` in `ui/lib.js` and `restoreState()` in `ui/lib.js`.
- **Page-head controls:** the heads of Status, Jobs, Efficiency, Agents and Issues hold, on the right and in this order, a Project select and then the Hour / Day / Week / Month control (`scopeBar()` in `ui/lib.js`). The Sessions head is the one page with its own window: `scopeBar()` draws a Project select and then 7 / 30 / 90 days (`days`), which stays out of the shared `aleph.window` storage because the API takes only those values. The project and the window stay in the address and across pages (`projectOf()`, `windowOf()`), and each page's requests carry both. Pause or Resume is on the Status head only, as the `act warn` classes (`ui/views/now.js`): it is an action with consequences, not a plain button.
- **Motion:** `.15s ease-out` on borders and backgrounds; no animation.

## Content

- **Markdown:** `md()` in `ui/lib.js` renders into `.md` in `ui/app.css`; headings are `600 var(--fs-lg)` in the sans face.
- **Code:** `pre` and `code` in `ui/app.css` use `--mono` at `--fs-xs`; blocks sit on `--sunk` with `--r-tag` and wrap (`pre`) or scroll (`.md pre`).
- **Diffs:** `.diff-panel` in `ui/app.css` on `--sunk`, max height 480px, added lines `--add`, removed `--del`, hunks `--muted` (`.diff-panel .d-hunk` in `ui/app.css`). `diffHtml()` in `ui/lib.js` renders a diff on the Job page and in an Ask card, and `loadDiff()` in `ui/lib.js` loads it.
- **Command box:** `cmd()` in `ui/lib.js` renders `.cmd` in `ui/app.css`, a mono button that copies on click with a `.cp` control (`.cmd .cp` in `ui/app.css`); `primary` (`.cmd.primary` in `ui/app.css`) inverts it.
- **Not determined:** the wrap rule of every long-text view was not traced.

## Voice and copy

- **Headers:** Title Case for page titles, section titles and column headers (`Efficiency`, `Uses per Day`, `First Prompt`); an article, conjunction or preposition of three letters or fewer stays lower case unless it is the first word (`Jobs per Item`); CSS uppercases two keys (`text-transform: uppercase`, 2 rows: the nav group heads at `#nav li.head` in `ui/app.css` and the metric card key at `.tile .k` in `ui/app.css`).
- **Counts in headings:** a count in a section heading sits in a `.count` span after the `h2`, muted and in the same size for every section (`Running`, `Queued`, `Done`); the `h2` holds only the title.
- **Buttons:** short verbs (`Show 50 more`, `Log out`).
- **States:** lower case, from the word sets in [Naming](naming.md); a priority is `critical`, `high`, `medium` or `low`.
- **Empty:** one sentence with a full stop and an optional hint, through `empty()` in `ui/lib.js`. Gates shows `empty()` in `ui/views/gates.js` as "Nothing waits for you."; Jobs shows `empty()` in `ui/views/jobs.js` as "No job matches." with "Widen the window or clear a filter."
- **Loading:** `loadingLine()` in `ui/lib.js` draws the inline line, `Loading <what>…`; `loading()` in `ui/lib.js` draws a view's first-load state, `Loading <title>…`.
- **Error:** `error()` in `ui/lib.js` says what failed, and the default hint is "Check that aleph-ui is running, then reload."
- **Offline:** "The server is unreachable. Showing the last data." (`ui/index.html`).
- **Missing value:** `–`, except where a helper returns an empty string.

## Layout and responsive

- **Shell:** a sidebar (`#nav` in `ui/app.css`, grouped by `work`, `factory`, `claude`) and `main` in `ui/index.html`; the sidebar collapses to 48px on desktop (`.shell.collapsed` in `ui/app.css`) and its state is kept in `localStorage` (`ui/index.html`).
- **Page:** `.page` in `ui/app.css` is at most 2400px wide with `28px 24px 64px` padding, `20px 16px 48px` at 720px and below.
- **Skeleton:** `pageHead()` in `ui/lib.js` with the serif title and a muted count, then `card()` sections in `ui/lib.js` with a `sectionHead()` in `ui/lib.js`; Status has its own `.shead` in `ui/app.css`. A detail page starts with `crumb()` in `ui/lib.js`.
- **Grid:** `.tiles` in `ui/app.css` holds the metric cards (see Metric cards).
- **Phone:** at 720px and below, 11 `@media` queries change the layout; tables scroll inside `.tscroll` in `ui/app.css`. What each table does at a phone width was not seen in a browser.

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
| white on `--seg-reran` (the lowest of the five) | 4.70 | 4.70 |

All pairs listed pass 4.5:1. `ui/stuck-contrast.test.ts` tests the stuck pair. A state is shown by a text badge as well as colour, but a bar's tone and the diff colours rely on colour. The focus ring (`:focus-visible` in `ui/app.css`) is visible on all controls. Sort headers set `aria-sort` (`sortHead()` in `ui/lib.js`) and selector cards set `aria-pressed` (`statCard()` in `ui/lib.js`).

## Components

Reference view = the view that follows the rules best.

| Component | Helper | Reference view |
|---|---|---|
| Page header | `pageHead()` | `ui/views/jobs.js` |
| Card | `card()` | `ui/views/factory-agents.js` |
| Table | `dataTable()`, `sortHead()` | `dataTable()` in `ui/views/jobs.js` |
| Badge | `badge()` | `ui/views/jobs.js` |
| Chip | `chips()` | `ui/views/issues.js` |
| Button | `.act`, `.cmd` | `ui/views/issues.js` |
| Chart | `panelOf()` | `ui/views/factory-agents.js` |
| Metric card (the standard data card) | `statCard()`, `cardTrend()`, `tiles()` | `ui/views/speed.js` `statusCards()` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `pager()` in `ui/views/issues.js` |
| Empty state | `empty()` | `empty()` in `ui/views/jobs.js` |

Cards with their own markup, because `card()` would add a heading or change the element:

- Memory browse table (`#mem-table` in `ui/views/memory.js`) and inspector (`#mem-inspector`): the table card has no heading, and the inspector is an `aside` with `aria-live`.
- Pipeline (`renderPipeline()` in `ui/views/now.js`): one box per stage in pipeline order (intake, triage, plan, spec-check, build, review, recheck, land) with the window's runs per issue and p90 runtime from `stages.rows` in `/api/speed`; a stage with no run in the window is dashed and says idle. Each box is a button that picks its stage (a second click picks all stages); the pick stays through `keep()`. The boxes are one row of 8, or 2 rows of 4 when the card is under 760px. Under them, two lists side by side (one column under 760px) from `stages.worst`: `<Stage> Reliability`, at most 5 issues with the most failed runs in the stage, and `<Stage> Performance`, at most 5 issues with the most time in the stage's runs; with no stage picked the name is Pipeline and the lists cover all stages.

These references were chosen by reading the code, not by looking at the pages. Gap: no view is a reference for a chart's loading state.

## Rules

Use:

- a colour token from `ui/app.css` for every colour, and `readTokens()` for a chart;
- `--fs-xs`, `--fs-sm`, `--fs-md`, `--fs-lg` for font sizes, and `--r-card`, `--r-ctl`, `--r-tag` for radii;
- `when()`, `day()`, `hourLabel()`, `clock()`, `dur()`, `durMs()`, `money()`, `count()`, `pct()` for times, durations, costs, counts and percents;
- `dataTable()` with `heads()` or `sortHead()` for a table, `empty()` for an empty state, and `badge()` for a state;
- the column order time (first), id or name, title, state, project, labels, numbers;
- `--sp-*` for `gap`, `padding` and `margin`; `--dim` for a dimmed control, `--ctl-h` for a control height and `--bar-h` for a bar height.

Never hard-code: a hex colour or shadow in CSS or in a view (except the allowed literals under Tokens), a font size, radius or `z-index` in a literal, a breakpoint other than 720px and one wide width, or a date, number or duration format written inline.

## Deviations

Each deviation is a value or pattern in the code that a rule above does not allow. Where an open issue fixes it, the issue is named as pending. A deviation with no open issue is a follow-up. The audit of 2026-11-04 listed raw colours, off-rule breakpoints and literal z-index values. The inventory finds none of them on this tree.

| Deviation | Where | Rule | Fix |
|---|---|---|---|
| Time column names differ: `Started`, `Updated`, `Last`, `When`, `Date`, `Written` | Tables | Column order, time column | aleph-1360 (pending) |
| Code-span writer copied across views (`inline`, `code`) | `ui/views/jobs.js`, `ui/views/issues.js`, `ui/views/now.js` and `ui/lib.js` | One helper per copy | aleph-1375 (pending) |
| Login sizes as literals | `ui/auth.ts` | Spacing and size tokens | none; follow-up |
| Dates with no time: `Oct 28` in tables, `10/28` proposed | `ui/views/issues.js`; `ui/views/memory.js` | Absolute time and day | Chris's decision (see Formats) |

The cost chart on Agents (`costFrame()` in `ui/views/factory-agents.js`) has the unit `usd`, so its value axis keeps `minInterval: 0`, not whole-number steps: a cost in dollars has cents, and the axis labels go through `money()`.
