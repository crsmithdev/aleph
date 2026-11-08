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
- **Inventory false positives.** None on this tree. `querySelector("#eff")` (`ui/views/efficiency.js:86`) is no longer read as a colour literal.
- **Chart data.** No chart was drawn with real data.

## Principles

1. **One token set, two themes.** Colours are CSS custom properties on `:root` (`ui/app.css:3`), re-set for dark in two identical blocks, the `prefers-color-scheme` one at `ui/app.css:101` and the `data-theme="dark"` one at `ui/app.css:136`. Light is a lavender match for Palenight; dark is Palenight (Mild Contrast).
2. **Shared helpers build the parts.** Views call `ui/lib.js` for a page head, card, table, badge, chip, filter bar, pager, metric card, meter and bar list. The CSS for them is in `ui/app.css`.
3. **Meaning is a tone.** A state is `run`, `done`, `need`, `stuck` or `quiet`, mapped by `tone()` (`ui/lib.js:295`). The same tone colours a badge, a chart series and a metric card.
4. **Numbers are tabular.** `font-variant-numeric: tabular-nums` has 12 literal uses, and number columns are right-aligned.
5. **Plain text states.** An empty state is one sentence and one hint, a missing value is `–`, and sentences end with a full stop.

## Tokens

All colour tokens are defined in three blocks of `ui/app.css`: light (`:root`), dark by media query, and dark by `data-theme`. That is the 98 colour `token-def` rows. Light and dark values are in `ui/app.css:3-72`, the `prefers-color-scheme` block at `ui/app.css:101` and the `data-theme` block at `ui/app.css:136`.

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
| `--approve`, `--decide`, `--unstick` | see `ui/app.css:34-36` | see `ui/app.css:131-133` | the three Ask cards, each with `-bg` and `-ring` |
| `--seg-landed`, `-returned`, `-failed`, `-reran`, `-dropped` | `ui/app.css:38` | same in both themes (not re-set in dark) | Efficiency outcome bar, under white text |
| `--fill-run`, `--fill-stuck`, `--fill-done`, `--fill-aux` | `ui/app.css:40-43` | same in both themes (not re-set in dark) | Timeline bar fills (`.dp-bar`), under white text |
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #1BAF7A, #EDA100, #E87BA4 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #C792EA, #89DDFF | extra chart series |
| `--lift` | `0 1px 3px` and `0 2px 8px` shadows | heavier black shadows | the top Status card |

The allowed colour literals outside the token blocks are the `#000` mask gradients of `.chat .clamp` (`ui/app.css:639`) and `.wf-detail .clamp` (`ui/app.css:694`), and the `color-mix(in srgb, currentColor 30%, transparent)` of `.cmd .cp` (`ui/app.css:323`).

Type, size and effect tokens (`ui/app.css:47-71`):

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

Weights are tokens: `--fw-text` 400 for text, `--fw-mid` 500 for ids and numbers, `--fw-strong` 600 for headings and table headers. 700 stays a literal on `.mark` (`ui/app.css:185`) and `.tile b` (`ui/app.css:759`).

Breakpoints are not tokens, because custom properties do not work in `@media`. There are two named widths: 720px and 1100px (wide). The queries in `ui/app.css` are `(max-width: 720px)` 11 times, `(max-width: 1100px)` 4 and `(min-width: 721px)` 1.

Spacing is tokens: `--sp-2`, `--sp-4`, `--sp-6`, `--sp-8`, `--sp-10`, `--sp-12`, `--sp-14`, `--sp-16`, `--sp-18`, `--sp-20`, `--sp-24` and `--sp-28` are 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24 and 28px, used for every `gap`, `padding` and `margin` on that scale. A negative margin is written `calc(-1 * var(--sp-2))`.  List indent is the token `--indent-list` (18px), used for every indented list. Widths and heights stay literal.

Radii: the five `--r-*` tokens. Shadows: `--lift`, plus `box-shadow: inset` rings for selected and parked states. Layers: `z-index` is tokens, `--z-rowlink` < `--z-sticky` < `--z-overlay`. Motion: 2 `transition` literals (`.15s ease-out`) and no CSS animation. The ECharts options set `animation: false` (8 rows).

### Missing tokens

These values repeat in the code with no token. Until a token lands, write the value given here.

| Proposed token | Value | Uses | Where |
|---|---|---|---|
| `--ls-display` | `letter-spacing: -0.01em` | 4 rows | `ui/app.css:185`, `210`, `211`, `490` |
| `--ls-caps` | one tracking for uppercase keys | 2 rows (`.06em`, `.08em`) | `ui/app.css:573`, `731` |

## Patterns

Each pattern below has 3 or more uses in the code, or is a fixed part of a component. Where the code uses another value, the row is a deviation, listed at the end.

| Rule | Value | Uses | Token to come |
|---|---|---|---|
| Display type tracking | `letter-spacing: -0.01em` on the brand mark, the shead text, the page title and display text | 4 rows (`ui/app.css:185`, `210`, `211`, `490`) | `--ls-display` |
| Small-caps key tracking | one value for uppercase keys; today `.06em` (`ui/app.css:573`) and `.08em` (`ui/app.css:756`) | 2 rows | none; pick one when a third key comes |
| Focus offset | `outline-offset: 2px` outside a control; `-2px` inside a container (segmented control, row, Ask head) | 2 and 5 rows (grep of `ui/app.css`) | none; a rule |
| Chart gridline | `opacity: 0.5` on `splitLine` | 4 rows (`ui/lib.js:601`, `614`, `626`, `ui/views/factory-jobs.js:31`) | none; a rule |
| Line height | a unitless multiplier, in `line-height` or the `font:` shorthand (`1.35`, `1.45`, `1.55`) | 15 `line-height` rows, 0 in px (grep of `ui/app.css` and `ui/index.html`) | none; a rule |

### Focus offset

- A control takes `outline: 2px solid var(--focus)` with `outline-offset: 2px` (`ui/app.css:182`).
- A control inside a container takes `outline-offset: -2px`, so the ring sits inside the box (`ui/app.css:506`, `678`, `986`).

### Chart gridlines and fills

- Gridlines are `splitLine` at `opacity: 0.5`.
- A stacked area series is filled at `areaStyle: { opacity: 0.6 }` (`ui/lib.js:603`), with a legend.
- A p90 band is filled at `opacity: 0.2` (`ui/views/factory-jobs.js:33`). It is one use and has no rule.

### Row actions

- No table has a row action column. The inventory of tables (see Tables) has no action column.
- A row's actions sit in a `.actions` box under the row's text, in the same card: `ui/views/jobs.js:208`, `ui/views/now.js:331`, `363`, `399`.
- A table cell holds data only.

### Key-value pairs and fact lists

- There are no key-value tables. A key and a value in a card or panel is a fact list: `<dl class="facts">` with one `<div>` per fact, `<dt>` for the key and `<dd>` for the value (`ui/views/memory.js:279`, `382`, `ui/views/session.js:167`, `265`, `ui/views/now.js:206`; 5 uses).
- The fact list is a flex row that wraps (`ui/app.css:370`). Its key is `--muted`; its value has `dd { margin: 0 }`.

### Form messages

- A result line after an action, or inside a form, is a `<span>` with the class `act-msg` (`ui/app.css:333`). `say()` in `ui/lib.js:721` writes the text and makes the line with `role="alert"` when there is none (callers: `ui/index.html:270`, `ui/views/gates.js:195`, `214`, `ui/views/issues.js:662`, `674`, `ui/views/session.js:231`). A line placed in markup keeps its role: `ui/views/cards.js:7` (alert), `ui/views/issues.js:460`, `490`, `495` (status).

### Two-click confirm

- Land (on an action without a choice box), Drop and Pause ask for a second click. The first click turns the label into `<label> <name>? Click again` for 5 seconds, then the label returns (`ui/index.html:294`). The second click runs the action.
- A deny or answer that needs a reason opens the reason box on the first click, and its button reads `Confirm` (`ui/index.html:285`).

### Chart empty state

- A card with a chart shows `empty()` in place of the chart when the chart has no data: `ui/views/skills.js:56` (`This skill was not used in the window.`).
- Gap: the Agents, Jobs and Issues charts draw an empty plot when the window has no data. No view is a reference for a chart's empty state.

## Formats

One format per kind of value. The helpers are in `ui/lib.js` unless named.

| Kind | Format | Example | Helper | Missing |
|---|---|---|---|---|
| Absolute time | mm/dd hh:mm, 24-hour; `YYYY-MM-DD` in another year | 10/28 14:05 | `when()` (`ui/lib.js:307`) | empty string |
| Day | month name and day; `YYYY-MM-DD` in another year | Oct 28 | `day()` (`ui/lib.js:322`), `dateText()` (`ui/views/issues.js:183`) | empty string |
| Axis hour | 12-hour, `a` or `p` | 4a, 1:36p | `hourLabel()` (`ui/lib.js:316`), for a chart axis only | none |
| Clock | 24-hour time | 14:05 | `clock()` (`ui/lib.js:12`) | empty string |
| Duration | seconds, minutes, hours, days; `durMs()` writes `850ms` under a second | 43s, 4m 05s, 1h 02m, 2d 04h, 850ms | `dur()` (`ui/lib.js:41`), `durMs()` (`ui/lib.js:52`), `span()` (`ui/lib.js:55`) for two timestamps | `–` from `dur()`, empty from `durMs()` |
| Cost | dollars, 2 decimals, `<$0.01` under half a cent | $1.25 | `money()` (`ui/lib.js:18`), also for the Runs today cost | `$0.00` |
| Weekly share | `≈1.4% wk` | ≈1.4% wk | `wkText()` (`ui/lib.js:30`), `costHtml()` (`ui/lib.js:33`) | empty string |
| Percent | whole number from 1%, one decimal below, `<0.1%` under 0.05% | 12%, 0.4% | `pct()` (`ui/lib.js:29`) | `–` |
| Count | thousands separators | 12,345 | `count()` (`ui/lib.js:19`) | none |
| Ids | mono, muted, `500 var(--fs-xs)`; forms in [Naming](naming.md) | a52 | `idLink()` (`ui/lib.js:341`), `repoIdLink()` (`ui/lib.js:351`) | none |
| Model | name without `claude-` and the version | opus | `shortModel()` (`ui/lib.js:329`) | empty string |
| Bytes | `B`, `KiB`, `MiB`, one decimal | 1.5KiB | `bytes()` (`ui/lib.js:25`) | none |
| Mean | one decimal | 2.4 | `mean()` (`ui/lib.js:21`) | `–` |
| Hours | one decimal under 10, whole from 10, then `h` | 3.2h, 12h | `hours()` (`ui/lib.js:23`) | none |

**A unit follows its number with no space**: `850ms`, `3.2h`, `1.5KiB`, `12min`, `10d`. `dur()` puts a space only between two groups (`4m 05s`). Server log lines and health text from the factory keep their own form (`135 s`); they are not UI formats.

Every absolute time goes through `when()`; a chart axis uses `day()` or `hourLabel()` (`xLabel()`, `ui/views/speed.js:20`). The `format` group has 64 `helper-bypass` rows (`bun skills/design-language/scripts/inventory.ts ui | grep helper-bypass`). None builds a displayed date, number or duration by hand outside `ui/lib.js`, except the rows below. Each stays for one of these reasons:

| Rows | Reason it stays |
|---|---|
| `ui/lib.js` (31 rows: `pad`, `clock`, `money`, `count`, `mean`, `hours`, `bytes`, `pct`, `durMs`, `when`, `hourLabel`, `day`, the bar row) | The helpers themselves. |
| `ui/activity.ts:20`, `ui/api/speed.ts:495-496` | Local-day date arithmetic for bucket starts, not display. |
| `getDate()` (`ui/views/issues.js:140`, `229`, `264`, `268`, `284`, `306`) | Local-day date arithmetic for windows and age bins, not display. |
| `toFixed()` (`ui/views/jobs.js:11`) | Rounds a window length to a stable number, not display. |
| `style` (`ui/views/session.js:146`), `ui/timeline.js:149` | Inline style widths and offsets in percent, read by CSS only. |
| `ui/api/skills.ts:92` | A server log line. |
| `ui/views/memory.js:188` | A bar width in percent, read by CSS only. |

## Tables

The one table is `dataTable()` (`ui/lib.js:546`) with `heads()` (`ui/lib.js:549`) or `sortHead()` (`ui/lib.js:682`), styled by `table.tbl` (`ui/app.css:448`). A table that can pass 50 rows is `pagedTable()` (`ui/lib.js:669`), which wraps `dataTable()` and `pager()`. Every table goes through one of the two.

Rules, as the code states them (`ui/app.css:448`):

- **Column order:** time first, then id or name, title, state badge, project, labels, numbers. A duration is a number and stays among the numbers; its header is always `Took`.
- **Time column name:** one past-tense word for the event (`Started`, `Updated`, `Written`, `Committed`, `Logged`, `Denied`), or `Last` followed by the event (`Last Turn`, `Last Call`, `Last Run`) when a row stands for many events and shows the newest.
- **Spare width:** the widest text column is `td.wide` (`ui/app.css:454`); it is cut with an ellipsis (`max-width: 0`, `overflow: hidden`).
- **Alignment:** text left; numbers right with the `.num` class (`ui/app.css:460`) on `th` and `td`, in `--num` with tabular figures and weight 500.
- **Cells:** `white-space: nowrap`, padding `--sp-6 --sp-12 --sp-6 0`, a `--rule-2` line under each row, and `--sunk` on row hover (`ui/app.css:449`, `453`). Headers are `600 var(--fs-xs)` in `--muted`.
- **Sort:** a header button with `data-sort`; the sorted header is `--ink` with `aria-sort`, and the arrow is `▲` or `▼` (`ui/lib.js:684`).
- **Pager:** `pager()` (`ui/lib.js:663`) shows "50 of 345" and "Show 50 more"; `PAGE` is 50, set by `PAGE` (`ui/views/issues.js:29`) and `PAGE` (`ui/views/jobs.js:45`).
- **Long text:** `clamp()` (`ui/lib.js`) sets long text clamped, followed by a button with `aria-expanded` that opens and closes it. A list that shows its first N rows uses `moreFold()` (`ui/lib.js`).
- **Wide tables:** `.tscroll` (`ui/app.css:472`) scrolls sideways.
- **Empty table:** `empty()` (`ui/lib.js:61`) in place of the table.

Columns of the main tables:

| Table | Columns, in order | Source |
|---|---|---|
| Issues | Updated, Id, Title, Stage, Project, Priority, Labels, Notes (num), Runs (num), Cost (num), Age (num) | `dataTable()` (`ui/views/issues.js:217`) |
| Jobs | Started, Job, Title, State, Project, Model, Took (num), Cost (num) | `dataTable()` (`ui/views/jobs.js:83`) |
| Sessions | Started, Last Turn, Session, First Prompt, Project, Kinds, Turns (num), Cost (num) | `dataTable()` (`ui/views/sessions.js:117`) |
| Memory notes | Written, Title, Kind, Scope, Read, Status | `dataTable()` (`ui/views/memory.js:251`) |
| Turns of a session | Started, Turn (num), Prompt, Output, Model, Tools (num), Took (num), Cost (num) | `dataTable()` (`ui/views/session.js:25`) |
| Observations | Kind, Name, Detail, Took (num) | `dataTable()` (`ui/views/session.js:263`) |
| Gates log | Logged, By, Subject, Action, Sub, Content, Times (num) | `dataTable()` (`ui/views/gates.js` `renderLog`) |
| Hooks | Last Call, Hook, Calls (num), Errors (num) | `dataTable()` (`ui/views/sessions.js:101`) |
| Denials | Denied, Reason | `dataTable()` (`ui/views/sessions.js:104`) |
| Efficiency | Issue, Why, Took (num), Runs (num); Issue, Usage (num), Runs (num) | `dataTable()` (`ui/views/efficiency.js:42`), `pagedTable()` (`ui/views/efficiency.js:45`) |
| Agents by role | Role, Model, one number column per measure, Jobs | `dataTable()` (`ui/views/factory-agents.js:65`) |
| Job checks | Check, Result, Ran (num), Passed (num), Failed (num), Skipped (num), Took (num), Log; then each failed test with its failure | `pagedTable()` (`ui/views/jobs.js:192`) |
| Commits | Committed, Commit, Subject, Part | `pagedTable()` (`ui/views/issues.js:622`) |

Gaps: a missing cell is empty in some tables and `–` in others. Row height is set by padding, not by a value. Expansion is by `<details>` in lists, not in tables. Filters are a `.fbar` (`ui/app.css:495`) over the table.

## Charts and data displays

Charts are ECharts, themed by `chartTheme()` (`ui/lib.js:159`) and drawn by `chart()` (`ui/lib.js:184`); the theme reads the page tokens through `readTokens()` (`ui/lib.js:174`) and redraws on a colour-scheme change.

- **Series colours:** `--run`, `--done`, `--need`, `--stuck`, then `--chart-6` and `--chart-7`; agent roles use `--series-1` to `--series-5`.
- **Bars:** `barsOption()` (`ui/lib.js:573`) for counts over categories, with no animation, `barMaxWidth: 64` and a shadow-pointer tooltip. Uses: `barsOption()` (`ui/views/factory-agents.js:96`).
- **Stacked areas:** `stackedAreaOption()` (`ui/lib.js:595`) for a count split by a category over time; one series per category, stacked, at 60% opacity, with a legend; optional `lines` draw on a right axis. Uses: the open backlog by priority, with filed and closed lines, in `ui/views/issues.js`; live agents by role in `stackedAreaOption()` (`ui/views/factory-agents.js:73`).
- **Range bars:** `rangeBarOption()` (`ui/lib.js:621`) for a spread per category: a horizontal bar to the p50 and a tick at the p90, one row per category. Use: time to close by kind in `ui/views/issues.js`.
- **Jobs page:** three charts of the same height in one row (`trendOption`, `stripOption`, `slowestOption` in `ui/views/factory-jobs.js`), drawn by `chart()` with the theme tokens: p50 and p90 areas per bucket, with 0 for a bucket with no time; a strip with one dot per issue linking to the issue, with the time on a base-60 log axis that starts at 1m unless a time is under a minute and the filing time on the vertical axis (an issue with no filing time has no dot); and the 10 slowest stages as bars coloured by stage, ordered by stage then by issue, each linking to the issue (for Lead Time an issue has a row per slow stage). Each chart box has `role="img"` and an `aria-label` that states its data.
- **Agents page:** three charts of the same height in one row (`liveOption`, `outcomesOption`, `costOption` in `ui/views/factory-agents.js`), drawn by `chart()` with the theme tokens: live agents by role as a stacked area, one series per timed role in `--series-1` to `--series-5`; outcomes by role as stacked horizontal bars of succeeded, failed and stuck; and cost by model as stacked columns per bucket, from `buckets[].cost` in `/api/speed`. Each chart box has `role="img"` and an `aria-label` that states its data.
- **Status layout:** the status line and the metric cards span the page. Under them, the main column holds Agent Time, Pipeline and the lanes, and the Herald is a rail at the right (`clamp(300px, 24%, 340px)`), sticky and the viewport tall. Under 1100px the Herald goes under the main column; when the main column is under 760px the lanes take 2 columns.
- **Herald:** the badge says `N active` in the tone of the worst alert (a stuck job or an error is `stuck`, an Ask alone is `need`), or `Calm`. The alert cards come first with no heading, then two tabs: Events (the status history) and Issues (work running or landed today, pinned at the top, then the queue).
- **Alerts section (Status page):** the Herald holds the Asks and the stuck, failed and error cards. The cards are one full-width column, as the Asks are. Each card has the Ask card structure (`ask-box` with the meta row, then the fold, then the buttons); a stuck, failed or error card uses the red `unstick` tone. The id, priority, date and runtime sit inside the box and show while the fold is closed. The status line links `#awaiting` (Asks) and `#jobs-stuck` (stuck jobs) point at the two lists of the section.
- **Axes:** category x axis, value y axis from 0 with whole-number steps. The x label is `xLabel()` (`ui/views/speed.js:20`): `4a` or `1:36p` in the hour and day windows, `Oct 25` in week and month. The cost chart on Agents is the one exception (see Deviations).
- **Meters:** `meter()` (`ui/lib.js:556`) draws every share bar, one share or segments, as `.meter` (`ui/app.css:827`, 10px) with `role="img"` and an `aria-label`, or `aria-hidden` beside a visible value. Uses: bar lists, the Efficiency table, Status cells, Sessions tools, Memory recall and the Usage card.
- **Bar lists:** `barRow()` (`ui/lib.js:564`) and `barList()` (`ui/lib.js:570`): label, meter, value on one grid.
- **Badges and chips:** `badge()` (`ui/lib.js:357`) and `priorityBadge()` (`ui/lib.js:361`) are squared with `--r-tag`; `chips()` (`ui/lib.js:373`) are pills.
- **Agent Time bar:** `bar()` in `ui/views/speed.js`, on Status and Efficiency: `.obar`, 28px high, in the five `--seg-*` colours with no text on the bar. A legend (`.olegend`) under it names each outcome with its hours and share, as `landed (40h 57%)`.
- **Loading and empty:** a chart's loading line is `loadingLine()` (`ui/lib.js:77`), which returns `<p class="quiet" role="status">Loading <what>…</p>`; the Agents view calls it at `ui/views/factory-agents.js:117`. Units are not set in one place; the legend is one shared option (`legend`, `ui/lib.js:583`), and each option names its series.

## Metric cards

A metric card is the standard data card. The Status scorecard set the design; every page with metric cards uses it. `statCard()` (`ui/lib.js:524`) draws one card, `tiles()` (`ui/lib.js:532`) lays the cards out as an auto-fit grid of 150px minimum that stretches to fill the row, and the CSS is `.tile` (`ui/app.css:751`). Do not write card markup by hand.

A card has 3 rows and nothing else:

| Row | Content | Style |
|---|---|---|
| 1 | The key, left; the trend, right | Key: `--fs-xs`, `--fw-strong`, `--muted`, uppercase, `.08em` letter spacing (`ui/app.css:731`). Trend: `--fs-sm`, `--fw-strong` |
| 2 | The value; then the second value as ` / v2` | Value: 700 in `--metric`, tabular numbers, `--ink`, on one line that never wraps: the card is a size container and the value is `clamp(16px, 13cqi, --fs-metric)`, so it shrinks with the card's width. Second value: 400, 0.62 of the value's size (20px at full size), `--muted`, not italic |
| 3 | A qualifier that names the two values (`p50 / p90`), or a note | `--fs-xs`, one line, cut with an ellipsis; the note's full text is its tooltip. Qualifier: the first name `--ink`, ` / second` `--muted`, both in lower case (`all / manual`, not `All / Manual`); a proper name such as `Chris` keeps its capital. Note: `--muted` |

- **Values:** text, made with the format helpers (`pct()`, `dur()`, `money()`, `count()`). An unknown value is `–`. The second value and the qualifier go together: a card with `v2` has `q` naming both values, unless the key already names them.
- **Trend:** `cardTrend()` (`ui/lib.js:507`) only. `▲` or `▼` and the change from `pct()`, or `▬ 0%` for no change. `kind: "points"` compares shares in percentage points; `"relative"` compares times and counts by relative change. The tone is `good` (`--good`) or `warn` (`--need`) from `lowerIsGood`. Each card states which direction is good. A neutral (`--muted`) trend (`lowerIsGood: null`) is only for a card where neither direction is good. The tooltip gives the previous value and the baseline, or a `tip` that says what the trend compares. No trend when there is no baseline.
- **Bar:** an optional bar (`extra`) between rows 2 and 3, as on the Usage card (`meter()` with a mark, 10px).
- **Link or selector:** with `href` the card is a link to the page that explains the number; with `key` it is a button that selects the detail below the cards (`data-tile`, `aria-pressed`, `onTile()`). Hover sets a `--run` border; a selected card is `--raised` with a `--run` border. The key has no arrow.
- **Box:** `--surface`, a 1px `--rule` border, `--r-card`, `--sp-12` by `--sp-14` padding, a `--sp-4` gap between rows; `--gap-in` between cards.
- **Window:** the page head states the window (`pageHead(..., { count })`), so a card does not repeat it.
- **More than 3 rows:** what does not fit goes in the card or chart below the cards, not in the card.

Uses: Status, Efficiency, Jobs, Agents, Automation, Issues, Memory, Sessions.

Exception: the KPI strip of a detail page (`renderKpis()` in `ui/timeline.js`) is not a metric card. It is a row of facts about one job or issue (text, links, spans), not numbers with a trend, so it has no trend, no qualifier and no `statCard()`.

The Roles table on Agents has one row per role and model ("Worker · haiku"). Its Success cell is the success rate with a `cardTrend()` marker (`kind: "points"`, against the baseline). A rate under 70% (`WARN_RATE` in `ui/views/factory-agents.js`) shows in the `--need` tone. The Jobs cell links to `#/factory/jobs?role=<role>&condition=failed`.

## Interaction

- **Focus:** one ring for all, `2px solid var(--focus)` with a 2px offset (`ui/app.css:182`). Segmented buttons, rows and the Ask head use a negative offset (`ui/app.css:506`, `ui/app.css:678`, `ui/app.css:986`). See Patterns.
- **Hover:** a link or button darkens its border to `--ink-2` (`.act:hover` at `ui/app.css:329`, `.cmd:hover` at `ui/app.css:318`, cards) or its text to `--ink` (crumbs, `a.idl` at `ui/app.css:482`, sort buttons); a table row and a nav item take `--sunk` (`ui/app.css:574`); a metric card takes a `--run` border.
- **Pressed:** a selector (metric card, segmented button, bar row) sets `aria-pressed="true"`, drawn with `--raised`, `--rule-2` or `--sunk`.
- **Disabled:** `.act:disabled` is 60% opacity with a wait cursor (`ui/app.css:332`).
- **Active:** `.cmd:active` (`ui/app.css:319`) moves 1px down.
- **Disclosure:** `<details>` for the fold in a list and for the Ask card (`.ask-fold`, `ui/app.css:983`); the open state of each is kept across a redraw by `recordState()` (`ui/lib.js:229`) and `restoreState()` (`ui/lib.js:242`).
- **Page-head controls:** the heads of Status, Jobs, Efficiency, Agents and Issues hold, on the right and in this order, a Project select and then the Hour / Day / Week / Month control (`scopeBar()`, `ui/lib.js:494`). The Sessions head is the one page with its own window: `scopeBar()` draws a Project select and then 7 / 30 / 90 days (`days`), which stays out of the shared `aleph.window` storage because the API takes only those values. The project and the window stay in the address and across pages (`projectOf()`, `windowOf()`), and each page's requests carry both. Pause or Resume is on the Status head only, as the `act warn` classes (`ui/views/now.js:411`): it is an action with consequences, not a plain button.
- **Motion:** `.15s ease-out` on borders and backgrounds; no animation.

## Content

- **Markdown:** `md()` (`ui/lib.js:112`) renders into `.md` (`ui/app.css:596`); headings are `600 var(--fs-lg)` in the sans face.
- **Code:** `pre` (`ui/app.css:746`) and `code` (`ui/app.css:180`) use `--mono` at `--fs-xs`; blocks sit on `--sunk` with `--r-tag` and wrap (`ui/app.css:746`) or scroll (`.md pre`, `ui/app.css:598`).
- **Diffs:** `.diff-panel` (`ui/app.css:349`) on `--sunk`, max height 480px, added lines `--add`, removed `--del`, hunks `--muted` (`.diff-panel .d-hunk`, `ui/app.css:354`). `diffHtml()` (`ui/lib.js:271`) renders a diff on the Job page and in an Ask card, and `loadDiff()` (`ui/lib.js:279`) loads it.
- **Command box:** `cmd()` (`ui/lib.js:86`) renders `.cmd` (`ui/app.css:312`), a mono button that copies on click with a `.cp` control (`ui/app.css:323`); `primary` (`.cmd.primary`, `ui/app.css:320`) inverts it.
- **Not determined:** the wrap rule of every long-text view was not traced.

## Voice and copy

- **Headers:** Title Case for page titles, section titles and column headers (`Efficiency`, `Uses per Day`, `First Prompt`); an article, conjunction or preposition of three letters or fewer stays lower case unless it is the first word (`Jobs per Item`); CSS uppercases two keys (`text-transform: uppercase`, 2 rows: the nav group heads at `ui/app.css:573` and the metric card key at `ui/app.css:731`).
- **Counts in headings:** a count in a section heading sits in a `.count` span after the `h2`, muted and in the same size for every section (`Running`, `Queued`, `Done`); the `h2` holds only the title.
- **Buttons:** short verbs (`Show 50 more`, `Log out`).
- **States:** lower case, from the word sets in [Naming](naming.md); a priority is `critical`, `high`, `medium` or `low`.
- **Empty:** one sentence with a full stop and an optional hint, through `empty()` (`ui/lib.js:61`). Gates shows `empty()` (`ui/views/gates.js:108`) as "Nothing waits for you."; Jobs shows `empty()` (`ui/views/jobs.js:74`) as "No job matches." with "Widen the window or clear a filter."
- **Loading:** `loadingLine()` (`ui/lib.js:77`) draws the inline line, `Loading <what>…`; `loading()` (`ui/lib.js:79`) draws a view's first-load state, `Loading <title>…`.
- **Error:** `error()` (`ui/lib.js:82`) says what failed, and the default hint is "Check that aleph-ui is running, then reload."
- **Offline:** "The server is unreachable. Showing the last data." (`ui/index.html:31`).
- **Missing value:** `–`, except where a helper returns an empty string.

## Layout and responsive

- **Shell:** a sidebar (`#nav`, `ui/app.css:568`, grouped by `work`, `factory`, `claude`) and `main` (`ui/index.html:30`); the sidebar collapses to 48px on desktop (`ui/app.css:584`) and its state is kept in `localStorage` (`ui/index.html:47`, `51`).
- **Page:** `.page` is at most 2400px wide with `28px 24px 64px` padding, `20px 16px 48px` at 720px and below (`ui/app.css:208`, `ui/app.css:542`).
- **Skeleton:** `pageHead()` (`ui/lib.js:302`) with the serif title and a muted count, then `card()` sections (`ui/lib.js:542`) with a `sectionHead()` (`ui/lib.js:687`); Status has its own `.shead` (`ui/app.css:209`). A detail page starts with `crumb()` (`ui/lib.js:344`).
- **Grid:** `.tiles` (`ui/app.css:750`) holds the metric cards (see Metric cards); `.lanes` (`ui/app.css:189`) is 3 columns, 2 at 1100px and below (`ui/app.css:536`), 1 at 720px and below (`ui/app.css:538`).
- **Phone:** at 720px and below, 11 `@media` queries change the layout; tables scroll inside `.tscroll` (`ui/app.css:472`). What each table does at a phone width was not seen in a browser.

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

All pairs listed pass 4.5:1. `ui/stuck-contrast.test.ts` tests the stuck pair. A state is shown by a text badge as well as colour, but a bar's tone and the diff colours rely on colour. The focus ring (`ui/app.css:182`) is visible on all controls. Sort headers set `aria-sort` (`ui/lib.js:684`) and selector cards set `aria-pressed` (`statCard()`, `ui/lib.js:529`).

## Components

Reference view = the view that follows the rules best.

| Component | Helper | Reference view |
|---|---|---|
| Page header | `pageHead()` | `ui/views/jobs.js` |
| Card | `card()` | `ui/views/factory-agents.js` |
| Table | `dataTable()`, `sortHead()` | `dataTable()` (`ui/views/jobs.js:83`) |
| Badge | `badge()` | `ui/views/jobs.js` |
| Chip | `chips()` | `ui/views/issues.js` |
| Button | `.act`, `.cmd` | `ui/views/issues.js` |
| Chart | `chart()`, `barsOption()` | `ui/views/factory-agents.js` |
| Metric card (the standard data card) | `statCard()`, `cardTrend()`, `tiles()` | `ui/views/speed.js` `statusCards()` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `pager()` (`ui/views/issues.js:217`) |
| Empty state | `empty()` | `empty()` (`ui/views/jobs.js:74`) |

Cards with their own markup, because `card()` would add a heading or change the element:

- Memory browse table (`#mem-table`, `ui/views/memory.js:290`) and inspector (`#mem-inspector`): the table card has no heading, and the inspector is an `aside` with `aria-live`.
- Pipeline (`renderPipeline()` in `ui/views/now.js`): one box per stage in pipeline order (intake, triage, plan, spec-check, build, review, recheck, land) with the day's jobs per issue from `monitor.stages` and the p90 runtime from a `p90` field (`–` until the monitor sends it); an idle stage is dashed. The boxes are one row of 8, or 2 rows of 4 when the card is under 760px. Under them, Slowest work lists at most 5 running and queued items, longest since first pickup first.

These references were chosen by reading the code, not by looking at the pages. Gap: no view is a reference for a chart's empty or loading state.

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
| Chart boxes without `role="img"` or `aria-label` | `ui/views/issues.js` (`backlog`, `close`, `tests`) | Charts: each chart box | aleph-1364 (pending) |
| Code-span writer copied across views (`inline`, `code`) | `ui/views/jobs.js:120`, `ui/views/issues.js:529`, `ui/views/now.js:335`, `ui/lib.js:93` | One helper per copy | aleph-1375 (pending) |
| Chart empty state drawn as an empty plot | Agents, Jobs and Issues charts | Chart empty state | none; follow-up |
| Login sizes as literals | `ui/auth.ts:53-57` | Spacing and size tokens | none; follow-up |
| Dates with no time: `Oct 28` in tables, `10/28` proposed | `ui/views/issues.js:176`; `ui/views/memory.js:140` | Absolute time and day | Chris's decision (see Formats) |

The cost chart on Agents (`costOption()` in `ui/views/factory-agents.js`) keeps `minInterval: 0` on its value axis, not whole-number steps: a cost in dollars has cents, and the axis labels go through `money()`.
