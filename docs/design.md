# UI design language

The design language of `ui/`, read from the code by the design-language skill (`skills/design-language/SKILL.md`). It goes from principles to foundations to components. Each component has what it is, a render, when to use it, and Do and Don't pairs. A value the rules do not allow is a deviation, listed at the end.

## Principles

1. **One token set, two themes.** Colours are custom properties on `:root` in `ui/app.css`, re-set for dark by `@media (prefers-color-scheme: dark)` and by `:root[data-theme="dark"]`. A view that uses only tokens gets dark mode free. Light is lavender; dark is Palenight.
2. **Shared helpers build the parts.** Views call `ui/lib.js`; the CSS is in `ui/app.css`. A fix in one helper fixes every page.
3. **Meaning is a tone.** `run`, `done`, `need`, `stuck` or `quiet`, from `tone()` in `ui/lib.js`. One state has one colour on a badge, a series and a card, so a reader learns it once.
4. **Numbers are tabular.** Tabular figures, right-aligned, so digits line up in a column.
5. **Plain text states.** An empty state is one sentence and a hint; a missing value is `–`.

### Rules

| Use | For |
|---|---|
| a colour token; `readTokens()` in a chart | every colour |
| `--fs-*`, `--r-*`, `--sp-*`, `--dim`, `--ctl-h`, `--bar-h` | sizes, radii, spacing, dimming, heights |
| `when()`, `day()`, `hourLabel()`, `clock()`, `dur()`, `durMs()`, `money()`, `count()`, `pct()` | every displayed value |
| `dataTable()`, `empty()`, `badge()` | tables, empty states, states |

| Do | Don't |
|---|---|
| `color: var(--muted)` | `color: #62688A` |
| `font-size: var(--fs-sm)` | `font-size: 13px` |
| `padding: var(--sp-6) var(--sp-10)` | `padding: 6px 10px` |
| `dur(245)` | `` `${Math.floor(s / 60)}m` `` |
| `@media (max-width: 720px)` | `@media (max-width: 800px)` |

Allowed literals: the `#000` masks of `.chat .clamp` and `.wf-detail .clamp`, and the `color-mix()` of `.cmd .cp`, all in `ui/app.css`.

## Foundations

### Colour

#### Surfaces and text

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | #F4F3FA | #202331 | the page |
| `--surface` | #FFFFFF | #292D3E | cards, the editor |
| `--sunk` | #ECEAF6 | #191C28 | chips, fields, code blocks, row hover |
| `--raised` | #ECEAF6 | #32374D | a selected metric card |
| `--ink` | #292D3E | #EEF1F8 | text |
| `--ink-2` | #4A4F6A | #BFC7D5 | secondary text |
| `--muted` | #62688A | #8E96BA | headers, meta |
| `--rule`, `--rule-2` | #DCD9EC, #E8E6F3 | #3A3F58, #2E3245 | borders, row lines |
| `--lift` | `0 1px 3px`, `0 2px 8px` | heavier | the top Status card |
| `--float` | `0 6px 24px rgb(0 0 0 / .25)` | the same | kit widgets: the font picker, the annotations |
| `--on-fill` | #fff | #fff | text on a coloured bar |

#### Tones

| Token | Light | Dark | Role |
|---|---|---|---|
| `--run` / `--run-bg` | #3B5FC8 / #EBEFFA | #82AAFF / #353E59 | running |
| `--done` / `--done-bg` | #437018 / #EDF2E8 | #A9C77D / #3B4347 | delivered |
| `--need` / `--need-bg` | #8A5A00 / #F3EEE6 | #FFCB6B / #474344 | needs you |
| `--stuck` / `--stuck-bg` | #C0304C / #F9EAED | #F07178 / #3D2C39 | stuck, error |
| `--good`, `--hot` | #437018, #C2521F | #C3E88D, #F78C6C | an improving trend; the largest cause |
| `--add`, `--del` | #437018, #C0304C | #A9C77D, #F07178 | diff lines |
| `--focus` | #7E57C2 | #C792EA | focus ring |
| `--approve`, `--decide`, `--unstick` | see `--approve` in `ui/app.css` | dark block | Ask cards, each with `-bg` and `-ring` |
| `--kind` / `--kind-bg` | `--stuck` / `--stuck-bg` | the same | an issue row's kind: `approval` uses `--run`, `input` uses `--need` |
| `--k` / `--k-bg` / `--k-ring` | `--approve` / `--approve-bg` / `--approve-ring` | the same | an Ask card: `decide` and `unstick` set their own |

#### Data colours

| Token | Light | Dark | Role |
|---|---|---|---|
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #1BAF7A, #EDA100, #E87BA4 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #C792EA, #89DDFF | extra series |
| `--seg-landed`, `-returned`, `-failed`, `-reran`, `-dropped` | `--seg-landed` in `ui/app.css` | not re-set | outcome bar, under white text |
| `--fill-run`, `--fill-stuck`, `--fill-done`, `--fill-aux` | `--fill-run` in `ui/app.css` | not re-set | Timeline bar fills, under white text |

| Do | Don't |
|---|---|
| a tone for a state: `--stuck` on a failed job | a tone for decoration |
| `--series-*` for roles, the same role in the same colour on every chart | a new colour per chart |
| text on its own `-bg`: `--need` on `--need-bg` | `--need` on `--stuck-bg` |

#### Contrast

The minimum is 4.5:1 for text and 3:1 for a mark. `ui/stuck-contrast.test.ts` tests the stuck pair.

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
| `--focus` on `--surface` | 5.21 | 5.67 |
| white on `--seg-reran` | 4.70 | 4.70 |

### Type

#### Sizes

| Token | Value | Role |
|---|---|---|
| `--fs-2xs` | 11px | badges on narrow cards, bar labels |
| `--fs-xs` | 12px | table headers, meta, badges |
| `--fs-sm` | 13px | table cells, secondary text |
| `--fs-md` | 14px | body |
| `--fs-lg` | 15px | section headings |
| `--fs-2xl` | 20px | brand mark, second metric value |
| `--fs-xl` | 26px | page title |
| `--fs-metric` | 32px | metric value |

#### Weights and families

| Token | Value | Role |
|---|---|---|
| `--fw-text` | 400 | text |
| `--fw-mid` | 500 | ids, numbers |
| `--fw-strong` | 600 | headings, table headers |
| `--sans`, `--mono`, `--num`, `--display`, `--metric`, `--brand` | Work Sans, Hack Nerd Font, Merriweather | body, code, numbers, titles |
| `--chart-scale`, `--chart-weight` | 1, 400 | text in the ECharts canvas: its relative size and weight |

Weight 700 stays a literal on `.mark` and `.tile b`.

#### Tracking and line height

| Proposed token | Value | Uses | Where |
|---|---|---|---|
| `--ls-display` | `-0.01em` | 4 | `.mark`, `.shead .say`, `.shead .asof`, `.ph h1` |
| `--ls-caps` | one tracking for uppercase keys | 4 (`.05em`, `.06em`, `.08em`) | `#nav li.head`, `.tile .k`, `.herald-sticky-head`, `.ins h4` |

| Do | Don't |
|---|---|
| `line-height: 1.45` | `line-height: 20px` |
| uppercase only on small keys: `#nav li.head`, `.tile .k`, `.herald-sticky-head`, `.ins h4` | uppercase a section heading |

### Space and shape

#### Spacing

| Token | Value |
|---|---|
| `--sp-2` | 2px |
| `--sp-4` | 4px |
| `--sp-6` | 6px |
| `--sp-8` | 8px |
| `--sp-10` | 10px |
| `--sp-12` | 12px |
| `--sp-14` | 14px |
| `--sp-16` | 16px |
| `--sp-18` | 18px |
| `--sp-20` | 20px |
| `--sp-24` | 24px |
| `--sp-28` | 28px |
| `--gap-in` | 16px, between metric cards |
| `--gap` | 24px, between page blocks |
| `--indent-list` | 18px, list indent |

| Do | Don't |
|---|---|
| `margin: calc(-1 * var(--sp-2))` | `margin: -2px` |
| `width: 320px` | `width: var(--sp-28)` for a width |

#### Radii

| Token | Value | Role |
|---|---|---|
| `--r-card` | 10px | cards |
| `--r-ctl` | 6px | controls |
| `--r-tag` | 4px | badges, code blocks |
| `--r-hair` | 2px | bars, marks |
| `--r-pill` | 999px | chips |

#### Controls and layers

| Token | Value | Role |
|---|---|---|
| `--ctl-h` | 28px | control height |
| `--bar-h` | 10px | `.meter` and `.wf-bar` height |
| `--dim` | .6 | opacity of a dimmed control |
| `--z-rowlink` | 1 | `tr.rowlink` links |
| `--z-sticky` | 2 | sticky bar, waterfall axis |
| `--z-overlay` | 50 | kit widgets: font picker, annotations |

Shadows: `--lift`, `--float` for the kit widgets, and `box-shadow: inset` rings for selected and parked.

#### Breakpoints and motion

| Rule | Value |
|---|---|
| Breakpoints | 720px and 1100px, literal, as `@media` takes no tokens |
| Motion | `.15s ease-out` on borders and backgrounds; no animation; ECharts `animation: false` |

### The kit bridge

The kit widgets in `ui/vendor/kit` read these. Each points at a base token, so one block serves both themes.

| Token | Value | Role |
|---|---|---|
| `--kit-bg` | `--surface` | a kit panel |
| `--kit-field` | `--bg` | a kit field |
| `--kit-sunk` | `--sunk` | a sunken area in a kit widget |
| `--kit-ink` | `--ink` | text in a kit widget |
| `--kit-muted` | `--muted` | secondary text in a kit widget |
| `--kit-rule` | `--rule` | a kit widget's borders |
| `--kit-accent` | `--focus` | a kit widget's accent |
| `--kit-shadow` | `--float` | a kit widget's shadow |
| `--kit-font` | `--sans` | a kit widget's text font |
| `--kit-code` | `--mono` | a kit widget's code font |
| `--kit-z` | `--z-overlay` | a kit widget's stacking order |

## Content

### Values

Every displayed value goes through its helper in `ui/lib.js`.

| Kind | Example | Helper | Missing |
|---|---|---|---|
| Absolute time | 10/28 14:05 | `when()` | empty |
| Day | Oct 28 | `day()` | empty |
| Axis hour | 4a, 1:36p | `hourLabel()`, axes only | none |
| Clock | 14:05 | `clock()` | empty |
| Duration | 43s, 4m 05s, 1h 02m, 2d 04h, 850ms | `dur()`, `durMs()` | `–` |
| Cost | $1.25, <$0.01 | `money()` | `$0.00` |
| Weekly share | ≈1.4% wk | `wkText()` | empty |
| Percent | 12%, 0.4%, <0.1% | `pct()` | `–` |
| Count | 12,345 | `count()` | none |
| Id | a52 | `idLink()`; see [Naming](naming.md) | none |
| Model | opus | `shortModel()` | empty |
| Bytes | 1.5KiB | `bytes()` | none |
| Mean | 2.4 | `mean()` | `–` |
| Hours | 3.2h, 12h | `hours()` | none |

| Do | Don't |
|---|---|
| `850ms`, `3.2h` | `850 ms`, `3.2 h` |
| `4m 05s` | `4:05`, `245s` |
| `10/28 14:05` | `Oct 28, 2:05 PM` |
| `opus` | `claude-opus-4-5` |
| `–` | `N/A`, `0`, `-` |

### Words

| Do | Don't |
|---|---|
| `Jobs per Item` | `Jobs Per Item`, `jobs per item` |
| `Running` with a muted `3` after it | `Running (3)` |
| `Show 50 more` | `Click here to load more results` |
| `running`, `landed`, `critical` | `Running`, `LANDED` |
| `No job matches.` with the hint `Widen the window or clear a filter.` | `No data` |
| `The agents did not load.` with the hint `Check that aleph-ui is running, then reload.` | `Error: fetch failed` |
| `Loading Jobs…` | a spinner with no text |

- States come from [Naming](naming.md); priorities are `critical`, `high`, `medium`, `low`.
- Offline: "The server is unreachable. Showing the last data." (`ui/index.html`).

## Components

Each component, its helper and the view that follows the rules best.

| Component | Helper | Reference view |
|---|---|---|
| Page head | `pageHead()` | `ui/views/jobs.js` |
| Card | `card()` | `ui/views/factory-agents.js` |
| Fact list | `facts()` | `ui/views/session.js` |
| Metric card | `statCard()`, `cardTrend()`, `tiles()` | `statusCards()` in `ui/views/speed.js` |
| Table | `dataTable()`, `sortHead()` | `ui/views/jobs.js` |
| Chart panel | `panelOf()` | `ui/views/factory-agents.js` |
| Meter | `meter()`, `barList()` | `ui/views/memory.js` |
| Badge | `badge()` | `ui/views/jobs.js` |
| Chip | `chips()` | `ui/views/issues.js` |
| Button | `actButton()`, `cmd()` | `ui/views/issues.js` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `ui/views/issues.js` |
| Empty state | `empty()` | `ui/views/jobs.js` |

### Structure

#### Page head

The serif title of a page, a muted count, and the page's controls at the right.

- **Use:** once per page, first, under the crumb of a detail page.
- **Page-head controls:** Project, then Hour / Day / Week / Month (`scope()` in `ui/lib.js`). Both stay in the address.

#### Card

A block of a page: a section head with an optional count and aside, then a body.

- **Use:** for each section of a page. Don't nest a card in a card.

#### Fact list

Keys and values for one thing: `<dl class="facts">`, the key muted.

- **Use:** for the properties of one item, on a detail page.

| Do | Don't |
|---|---|
| `facts()` | a two-column table of keys and values |

### Data

#### Metric card

One number with its key, at the top of a page. `tiles()` lays the cards out at 150px minimum, auto-fit.

| Part | Holds |
|---|---|
| 1 Key | the measure, in two or three words |
| 2 Trend | the change from a baseline, from `cardTrend()` |
| 3 Value | the number, from a format helper |
| 4 Second value | a second number after ` / `, such as the cap |
| 5 Bar | an optional meter |
| 6 Qualifier | what the numbers are, such as `in use / cap`, or a note |

- **Use:** for the headline numbers of a page. A number that needs more than three rows goes in a table below the cards.
- **Trend:** `▲`, `▼` or `▬ 0%`. Green when the change is good, from `lowerIsGood`; neutral when it is `null`; no trend without a baseline.
- **Link or selector:** `href` makes the card a link; `key` makes it select a view below, with `aria-pressed`.
- **More than 3 rows:** row 3 is one line; the full note is in the tooltip.

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | a `v2` with no `q` to name the two values |
| `v: "–"` with a note that says why | `v: "0"` for an unknown value |
| `statCard()` | card markup written by hand |
| facts for the KPI strip of a detail page (`renderKpis()` in `ui/timeline.js`) | a metric card on a detail page |

#### Table

Rows of items with the same columns: `dataTable()` with `heads()` or `sortHead()`. Over 50 rows: `pagedTable()`.

- **Column order:** time, id or name, title, state, project, labels, numbers.
- **Spare width:** the title is `td.wide`; it takes the spare width and ends in an ellipsis.
- **Sort:** `sortHead()` sets `aria-sort` and shows `▲` or `▼`.
- **Pager:** `pager()`: 50 rows, then "Show 50 more".
- **Long text:** `clamp()` with a Show more button; long lists with `moreFold()`.
- **Wide tables:** `.tscroll` scrolls sideways on a phone.
- **Empty table:** `empty()` in place of the table.

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed`: the time column says which time | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `.num`: right, tabular | numbers left-aligned |
| actions under a row's text (`.actions`) | a button in a table cell |

#### Chart panel

A titled chart drawn from a frame: `<aleph-chart key="<view>/<chart>">` (`ui/chart.js`).

| Frame part | Gives |
|---|---|
| measure | the title `<measure> by <dimension>`, the axis and tooltip format |
| over | the forms: Area, Columns, Lines, Points, Share; or Stacked, Grouped, Share |
| by | a colour token for each series |
| rows | the points; a row with `href` links |

- **Use:** a flow opens as Columns, a level as Area.
- **Series colours:** tones for states; `--series-1` to `--series-5` for roles.
- **Axes:** value axis from 0 in whole steps; labels from `day()` or `hourLabel()`.
- **No data:** the title and "Nothing to plot in this window."; a card with only a chart shows `empty()` instead.
- **Sticky state:** `keep()` and `kept()` in `ui/lib.js` keep how a chart shows; the address keeps what data it shows.

| Do | Don't |
|---|---|
| `color: "done"` in a frame's `by` | a hex colour in a series |
| a legend on a stacked chart | a stacked chart with no legend |

#### Meter

A 10px bar for one share or segments: `meter()`, with an optional mark. `barRow()` and `barList()` put a label, a meter and a value on one grid.

- **Use:** for a share of a known whole. For a trend over time, use a chart panel.

#### Outcome bar

A 28px bar of whole-window shares in `--seg-*` colours, with a legend such as `landed 40h 57%`: `bar()` in `ui/views/speed.js`.

### Labels

#### Badge and chip

A badge is a state, squared (`--r-tag`): `badge()`, `priorityBadge()`. A chip is a label, a pill: `chips()`.

| Do | Don't |
|---|---|
| `badge("failed")` | a chip for a state |
| `chips(["ui", "css"])` for labels | a badge for a label |

### Actions

#### Button and command

`.act` is a button, from `actButton()`. A command box shows a command in mono and copies it on click: `cmd()`; `primary` inverts it.

- **Use:** a short verb for the label. `act warn` for an action that stops or drops work.

#### Row actions

A row's buttons sit in `.actions` under its text.

#### Form message

The result of an action, beside its button: `say()` in `ui/lib.js` writes a `<span class="act-msg">` with `role="alert"`.

#### Two-click confirm

Land, Drop and Pause ask once more: the first click shows `<label> <name>? Click again` for 5 seconds (`ui/index.html`). An answer that needs a reason opens a reason box first; its button reads `Confirm`.

#### Disclosure

A `<details>` fold. `recordState()` and `restoreState()` in `ui/lib.js` keep it open across a redraw.

### Text

#### Markdown and code

- **Markdown:** `md()` in `ui/lib.js` into `.md`.
- **Code:** `--mono` at `--fs-xs` on `--sunk`; `pre` wraps, `.md pre` scrolls.

#### Diff

`diffHtml()` in `ui/lib.js` into `.diff-panel`: added lines `--add`, deleted lines `--del`, hunks `--muted`.

## States

- **Focus:** a `2px solid var(--focus)` ring, 2px outside a control.
- **Hover:** a border goes to `--ink-2`, or text to `--ink`; rows and nav items go to `--sunk`.
- **Pressed:** `aria-pressed="true"`, drawn `--raised` or `--sunk`.
- **Disabled:** 60% opacity and a wait cursor.
- **Active:** a command box moves 1px down.

### Focus offset

| Do | Don't |
|---|---|
| `outline-offset: -2px` inside a container (`.seg button:focus-visible`) | a ring that the container clips |
| `:focus-visible` | `:focus`, which also rings on a click |

## Layout

| Part | Rule |
|---|---|
| Sidebar | `#nav`, 48px when collapsed (`.shell.collapsed`) |
| Page | `.page`: 2400px max, `28px 24px 64px` padding, `20px 16px 48px` at 720px |
| Grid | `.tiles` holds metric cards; `.lanes` is 3 columns, 2 under 760px, 1 under 480px |
| Phone | 720px; tables scroll in `.tscroll` |

- **Skeleton:** `crumb()` on a detail page, `pageHead()`, then `card()` sections.

## Accessibility

- Contrast: see Colour.
- Bar tones and diff colours rely on colour alone.
- `aria-sort` on sort headers, `aria-pressed` on selector cards.

## Deviations

| Deviation | Where | Fix |
|---|---|---|
| Time column names differ | Tables | aleph-1360 (pending) |
| Code-span writer copied across views | `ui/views/jobs.js`, `ui/views/issues.js`, `ui/views/now.js`, `ui/lib.js` | aleph-1375 (pending) |
| Login sizes are literals | `ui/auth.ts` | follow-up |
| Dates with no time: `Oct 28` vs `10/28` | `ui/views/issues.js`, `ui/views/memory.js` | Chris's decision |
| A missing cell is empty in some tables and `–` in others | Tables | follow-up |
| Cost axis keeps cents (`minInterval: 0`, labels by `money()`) | `costFrame()` in `ui/views/factory-agents.js` | allowed |

## Appendix

### What could not be determined

| Gap | Note |
|---|---|
| Earlier decisions | Absolute time is `10/28 14:05`, as aleph-199 decided. No other decision outranks the code. |
| Browser checks | Responsive behaviour is read from the media queries, not seen. |
| Colour token uses | The inventory counts colour definitions, not uses. |
| Contrast | Only the listed pairs. `--muted` on `--rule-2` (4.41, 4.35) has no traced use. |
| Chart data | No chart was drawn with real data. |

### Bypasses that stay

| Rows | Reason |
|---|---|
| `ui/lib.js` (31) | the helpers |
| `ui/activity.ts` (3), `ui/views/issues.js` (3) | date arithmetic, not display |
| `ui/views/session.js` (2), `ui/timeline.js` (1), `ui/views/memory.js` (1) | percent widths for CSS |
| `ui/api/skills.ts` | a server log line |

### Inventory

From `bun skills/design-language/scripts/inventory.ts ui --summary`.

| group | kind | count |
|---|---|---|
| colour | literal | 5 |
| colour | token-def | 95 |
| effect | literal | 36 |
| effect | token-use | 7 |
| format | helper-bypass | 42 |
| size | literal | 140 |
| size | token-def | 18 |
| size | token-use | 522 |
| type | literal | 33 |
| type | token-def | 42 |
| type | token-use | 50 |
