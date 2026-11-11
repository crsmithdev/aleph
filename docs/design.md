# UI design language

The design language of `ui/`, read from the code by the design-language skill (`skills/design-language/SKILL.md`). It goes from principles to foundations to components. Each component has what it is, its rules, a Style table of the tokens each part takes, and Do and Don't pairs. A value the rules do not allow is a deviation, listed at the end.

The renders are on the Kit page, `#/kit` (`ui/views/kit.js`): each component and token, drawn by its own helper from fixture data, in light and dark. A new component gets a specimen there.

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
| Button | `actButton()` | `ui/views/issues.js` |
| Command | `cmd()` | `ui/views/issues.js` |
| Filter bar | `filterBar()` | `ui/views/jobs.js` |
| Pager | `pager()` | `ui/views/issues.js` |
| Empty state | `empty()`, `loading()`, `error()` | `ui/views/jobs.js` |
| Detail panel | `panel()`, `detailPanel()` in `ui/timeline.js` | `ui/views/jobs.js` |
| KPI strip | `renderKpis()` in `ui/timeline.js` | `ui/views/jobs.js` |
| Timeline | `renderTimeline()` in `ui/timeline.js` | `ui/views/jobs.js` |
| Legend | `legendHtml()` | `ui/timeline.js` |
| Item card | `laneCard()` in `ui/views/now.js`, `metaRow()` in `ui/views/cards.js` | `ui/views/now.js` |
| Ask card | `askCard()` in `ui/views/cards.js` | `ui/views/now.js` |
| Lane | `lane()` in `ui/views/now.js` | `ui/views/now.js` |
| Feed row | `eventRow()` in `ui/views/now.js` | `ui/views/now.js` |
| Findings list | `findingHtml()` in `ui/views/now.js` | `ui/views/gates.js` |
| Status row, link button | none yet | `ui/views/jobs.js` |

### Every component

These rules hold for each component below; its own list adds to them.

- Build it with its helper. Never write its markup by hand. A part with no helper yet is listed under Deviations until it has one.
- Colours, sizes, spacing and radii from tokens only (Principles, Rules).
- Every value through its format helper (Content, Values); a missing value as that table says.
- A state's colour from `tone()`; never pick a tone by hand.
- Headers and titles in Title Case with short words lower (`Jobs per Item`); states lower case.
- A count is a bare muted number after its title, never in brackets.
- Interaction states as States says: `:focus-visible`, `aria-pressed`, disabled while a request runs.
- A new component, or a new state of one, gets a specimen on `#/kit` and a section here.

Each Style table gives a component's parts and the tokens they take, from `ui/app.css`. The helper applies them; a builder never sets them.

### Structure

#### Page head

The page's serif title, a muted count, and the page's controls at the right.

- `pageHead(title, { count, aside })`.
- One per page, first; under `crumb()` on a detail page.
- `count`: the number of items the page lists, or none.
- `aside`: the page's controls only. Project, then the window (Hour, Day, Week, Month), from `scope().bar()`; then the page's own control in `after`.
- Project and window live in the address; `scope().wire(root)` in `mount`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Crumb | `--mono` `--fs-sm` | `--muted`; link hover `--ink` | `--sp-8` below |
| Title | `--display` `--fs-xl` | `--ink` | |
| Count | `--num` `--fs-sm` `--fw-mid` | `--muted` | |
| Aside | `--fs-xs` | `--muted` | right; wraps; gap `--sp-8` `--sp-12` |
| Head | | | `--sp-16` below; wraps at narrow width |

#### Card

A block of a list page: a section head with an optional count and aside, then a body.

- `card(title, body, { count, aside, id })`.
- One card per section of a list page. A detail page uses the detail panel. Never a card in a card.
- `title`: what the section holds, in Title Case.
- `aside`: the section's controls, or one muted note.
- `id` when another part of the page links to the section.
- A card with no content shows `empty()` in its body; the card stays.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Box | `--fs-sm` | `--surface`, border `--rule` | padding `--gap-in`, radius `--r-card`, gap `--sp-12` |
| Title | `--sans` `--fs-lg` `--fw-strong` | `--ink` | |
| Count | `--num` `--fs-sm` `--fw-mid` | `--muted` | |
| Aside | `--fs-xs` | `--muted` | right |
| Body text | | `--ink-2` | |

#### Detail panel

A block of a detail page (an issue or a job): a head, then a body.

- `panel(id, title, body, aside)` for prose (Spec, Result, Description); `detailPanel(title, aside, body)` for a fold that opens; both in `ui/timeline.js`.
- On a detail page only. A list page uses the card.
- `title` in Title Case; `aside`: a muted note or a control.
- Prose in the body: `md()`, at most 80 characters wide.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Box | | `--surface`, border `--rule` | radius `--r-card` |
| Head | `--sans` `--fs-lg` `--fw-strong` | `--ink` | padding `--sp-14` `--sp-18` |
| Aside | `--fs-sm` | `--muted` | |
| Body | | | padding `--sp-10` `--sp-18` `--sp-14` |
| Code block | `--mono` `--fs-xs` | `--ink-2` on `--sunk` | radius `--r-tag`; scrolls at 70% of the screen |

#### KPI strip

The headline facts of a detail page, in one row of cells.

- `renderKpis([{ k, v, sub, text }])` in `ui/timeline.js`, first in a detail page, under the status row.
- `v`: a format helper's output; `text: true` for words, which set smaller than a figure.
- `sub`: one muted line under the value.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Strip | | detail panel box | cells at 150px minimum, auto-fit |
| Cell | | border-left `--rule-2` | padding `--sp-14` `--sp-18`; on a phone, cells stack with border-top |

#### Status row

The state of a detail page's item, under its page head.

- `badge()` for the state, then `priorityBadge()`, then chips for the part and labels.
- On a detail page only, after the page head.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Row | | | gap `--sp-6`, `--sp-12` below; wraps |

#### Fact list

Keys and values for one thing.

- `facts([[key, html]])`.
- For the properties of one item on a detail page, or the meta line of a list row.
- Keys: one or two words, sentence case (`Started`, `Took`).
- Values: from their format helpers; HTML, so escape text with `esc()`.
- An empty value drops its row; never a placeholder.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| List | `--fs-sm` | `--ink-2` | wraps; gap `--sp-4` 22px |
| Key | | `--muted` | `--sp-6` before the value |
| Value | `--num` tabular | `--ink-2` | |

| Do | Don't |
|---|---|
| `facts()` | a two-column table of keys and values |

### Data

#### Metric card

One number with its key, at the top of a page.

| Part | Holds |
|---|---|
| 1 Key | the measure, in two or three words |
| 2 Trend | the change from a baseline, from `cardTrend()` |
| 3 Value | the number, from a format helper |
| 4 Second value | a second number after ` / `, such as the cap |
| 5 Bar | an optional meter |
| 6 Qualifier | what the numbers are, such as `in use / cap`, or a note |

- `statCard({ k, v, v2, q, note, trend, extra, href, key, on })`, in `tiles(label, html)`.
- For the headline numbers of a list page. A detail page uses the KPI strip instead.
- `k`: the measure, two or three words; CSS sets it in capitals.
- `v`: a format helper's output. Unknown is `–` with a `note` that says why.
- `v2` only with `q`, which names both values.
- Row 3: `q` or `note`, one line. A long note is cut; its full text is the tooltip.
- `trend`: only from `cardTrend(value, base, prev, { kind, lowerIsGood, format, basis })`. `kind` is `points` for a share and `relative` for a time or a count. `lowerIsGood` is `null` when neither way is good. No baseline gives no trend.
- `extra`: a `meter()` only.
- `href` goes to another page. `key` selects the view below it, with `on` for the pressed card, wired by `onTile()`.
- A number that needs more than three rows goes in a table below the cards.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Grid | | | 150px minimum, auto-fit, gap `--gap-in`; 2 columns on a phone |
| Card | `--fs-sm` | `--surface`, border `--rule` | padding `--sp-12` `--sp-14`, radius `--r-card`, gap `--sp-4` |
| Key | `--sans` `--fs-xs` `--fw-strong`, capitals, tracking .08em | `--muted` | |
| Trend | `--fs-sm` `--fw-strong` | `--good` when good, `--need` when bad, else `--muted` | right of the key |
| Value | `--metric` 700, up to `--fs-metric`, tabular | `--ink` | one line, ends in an ellipsis |
| Second value | `--metric` at .62em | `--muted` | hidden on a phone |
| Qualifier | `--fs-xs` | `--ink`, its second part `--muted` | one line, ends in an ellipsis |
| Link or selector | | hover border `--run` | |
| Pressed | | `--raised`, border `--run` | |

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | a `v2` with no `q` to name the two values |
| `v: "–"` with a note that says why | `v: "0"` for an unknown value |
| `statCard()` | card markup written by hand |
| the KPI strip on a detail page (`renderKpis()` in `ui/timeline.js`) | a metric card on a detail page |

#### Table

Rows of items with the same columns.

- `dataTable(head, rows, { fit })`; the head from `heads(labels, num)` or `sortHead()`.
- Columns in this order: time, id or name, title, state, project, labels, numbers.
- Time: `when()`, under a header that says which time.
- Id: `idLink()` or `repoIdLink()`.
- Title: `td.wide`. It takes the spare width and ends in an ellipsis. No other cell wraps.
- State: `badge()`. Labels: `chips()`.
- Numbers: `td.num`, and the header in `num`, so both are right-aligned in tabular figures.
- Sort: `sortHead()` with `wireTable()`; the sort lives in the address as `sort` and `dir`.
- Over 50 rows: `pagedTable()`, or `pager()` with `limitOf()`.
- `fit: true` for a short table of names and numbers.
- No rows: `empty()` in place of the table.
- Row actions sit under the row's text in `.actions`, never in a cell of their own.
- On a phone the table scrolls sideways in `.tscroll`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Table | `--fs-sm` | `--ink` | full width; `fit`: its content's width |
| Header | `--sans` `--fs-xs` `--fw-strong` | `--muted`; sorted `--ink` | |
| Cell | `--fw-text`, line height 1.45 | | padding `--sp-6` `--sp-12` `--sp-6` 0, rule `--rule-2` below, one line |
| Number | `--num` `--fw-mid` tabular | | right |
| Title | | | the spare width, 16ch minimum, ellipsis |
| Chip in a cell | | | 16ch maximum, ellipsis |
| Row hover | | `--sunk` | |
| Sort arrow | `--fs-xs` | | 1em wide |

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed`: the time column says which time | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `.num`: right, tabular | numbers left-aligned |
| actions under a row's text (`.actions`) | a button in a table cell |

#### Chart panel

A titled chart drawn from a frame (`ui/chart.js`).

| Frame part | Gives |
|---|---|
| measure | the title `<measure> by <dimension>`, the axis and tooltip format |
| over | the forms: Area, Columns, Lines, Points, Share; or Stacked, Grouped, Share |
| by | a colour token for each series |
| rows | the points; a row with `href` links |

- `panelOf(key, frame)` in `render`; set the element's `frame` in `mount`.
- `key`: `<view>/<chart>`, one per chart.
- `measure.unit`: `count`, `usd` or `seconds`; it picks the axis and tooltip format. `agg`: `sum` for a flow, `max` for a level.
- A flow opens as Columns, a level as Area. Never write the title; the frame gives it.
- Each key in `by` names a colour token: tones for states, `series-1` to `series-5` for roles. A key keeps its colour in every window.
- A legend, unless the frame has one key that the title names (`legend: false`).
- The value axis starts at 0; a count axis steps in whole numbers.
- No data: the frame's `empty` line. A card that holds only a chart shows `empty()` instead.
- Data that failed to rebuild: pass `error` and `since`; the panel says how old it is.
- Two or three panels side by side go in `.trio`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Panel | | card box | fills its grid cell |
| Form control | | segmented control | in the card's aside |
| Plot | axis labels `--chart`, 12px times `--chart-scale`, `--chart-weight` | `--ink` labels, `--rule` lines; series tokens through `readTokens()` | 200px minimum high |
| Grid lines | | at half opacity | |
| Row of panels | | | `.trio`: 3 columns, gap `--gap-in`; 1 column under 1100px |

| Do | Don't |
|---|---|
| `color: "done"` in a frame's `by` | a hex colour in a series |
| a legend on a stacked chart | a stacked chart with no legend |

#### Legend

The key of a chart that is not a chart panel.

- `legendHtml([[label, cls]])`; `cls` gives the swatch its colour token.
- A chart panel draws its own legend; never add one.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| List | `--fs-xs` | `--muted` | one row, wraps; gap `--sp-4` `--sp-14` |
| Swatch | | its token | 10px square, radius `--r-hair` |

#### Meter

A bar for one share or for segments.

- `meter(parts, label, { mark })`: one percent, or segments `{ pct, cls }`.
- For a share of a known whole. A trend over time is a chart panel.
- `label`: the text alternative. Leave it out only when the value shows beside the bar.
- `mark`: a target or the time gone.
- Rows of label, bar and value: `barRow()` in `barList()`; `top` marks the largest.
- The container gives the meter its width.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Track | | `--sunk` | `--bar-h` high, radius `--r-hair` |
| Fill | | `--muted`; the top row `--hot`; a segment its class | |
| Mark | | `--ink` | 2px wide, 16px high |
| Bar list | `--fs-sm` | label `--ink`, value `--ink-2` | label 80–200px, value right and tabular; rule `--rule-2` between rows |
| Pressed row | | `--sunk`, label `--fw-strong` | |

#### Outcome bar

A bar of whole-window shares, with a legend such as `landed 40h 57%`.

- `bar(d, key)` in `ui/views/speed.js`, from `/api/flow`.
- Classes that reached main sit left of the separator, the rest right.
- Each segment selects the detail below it, with `aria-pressed`.
- No hours: `empty()`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Segment | | `--seg-*` of its class | 28px high; ends rounded `--r-ctl`; gap `--sp-2` |
| Separator | | `--ink-2` | 2px; margin `--sp-8` |
| Legend | `--fs-xs` tabular | `--ink-2`, figures `--muted` | gap `--sp-4` `--sp-16` |
| Pressed | | outline 2px `--ink` | |
| Phone | | | groups stack; the separator turns flat |

#### Timeline

The runs of an issue or a job over time, with their events.

- `renderTimeline(segments)` in `ui/timeline.js`, in a detail panel.
- One row per run: head, lane of bars and waits, result, time, cost.
- A bar's tone: build, bad, land or aux. A wait for Chris is striped in the need colours.
- Each row's events under it; a long event is clamped.
- A legend from `legendHtml()` in the panel head.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Grid | | | head 160–220px, lane 300px minimum, result, time, cost; scrolls under 740px |
| Axis | `--fs-xs` tabular | `--muted` | |
| Lane | | `--bg` | 22px high, radius `--r-tag` |
| Bar | `--fs-2xs` `--fw-mid` | `--on-fill` on `--fill-*` | 18px high, radius `--r-hair` |
| Wait | | stripes of `--rule`; for Chris `--need` on `--need-bg` | |
| Mark | | made `--muted`, done `--ink` | 2px wide |
| Event | `--fs-sm`; time `--fs-xs` tabular | time `--muted` | time, tag, text; padding `--sp-4` |
| Segment head | `--fs-sm` `--fw-strong` | | rule `--rule` above |

### Lists of items

#### Item card

One issue or job in a lane: a meta row, then its title on one line.

- `laneCard()` in `ui/views/now.js`; the meta row from `metaRow()` in `ui/views/cards.js`.
- Meta row: id, state badge, kind, part, then numbers, all on one line.
- Title: one line, a link to the item.
- A card that waits on Chris takes the need border.
- `data-annotate` with the item's short id, so a note stays on the item.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Box | | `--surface`, border `--rule`; waiting on Chris `--need` | padding `--sp-10` `--sp-12`, radius `--r-ctl` |
| Kind edge | | land `--done`, worker `--run`, else `--rule` | 4px on the left |
| Meta row | `--fs-2xs`; badge `--fs-2xs` | | 22px high, one line, gap `--sp-4` |
| Title | `--sans` `--fw-strong`, line height 1.35 | inherits | one line, ellipsis; `--sp-4` above |

#### Ask card

A question for Chris: what it is, its options, and the buttons that answer it.

- `askCard(i)` in `ui/views/cards.js`.
- Head: a dot, the kind in bold, the title. The fold opens to the question, the options and the reasons.
- One button per choice, from `actButton()`; the recommended choice says so.
- Choices that need a reason use the two-click confirm's reason box.
- Technical details sit in a closed fold at the end.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Kind | | approve, decide or unstick: each sets the card's colour, its `-bg` and its `-ring` (`--approve`, `--decide`, `--unstick`) | |
| Box | | `--surface`, border the kind's ring, shadow `--lift` | radius `--r-card` |
| Meta row, head | head `--fs-lg`, line height 1.35 | on the kind's `-bg` | padding `--sp-12` `--sp-18` |
| Dot | | the kind's colour | 10px round |
| Kind label | `--fw-strong` | the kind's colour | |
| Title | `--fw-mid` | `--ink` | wraps |
| Question | `--fs-lg` `--fw-strong` | | 80ch maximum |
| Choice text | `--fs-md`, line height 1.5 | `--ink-2` | |
| Recommended | `--fs-xs` `--fw-strong` | the card's kind colour | |
| Choices | | | wrap, gap `--sp-8`; open: 200px button column, then the text |

#### Lane

A column of item cards under a section head with a count.

- `lane()` in `ui/views/now.js`: the head, then the cards, or one quiet line.
- Three lanes side by side in `.lanes`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Lanes | | | 3 columns, gap `--sp-20` |
| Cards | | | one column, gap `--sp-12` |
| Empty line | `--fs-sm` | `--muted` | |

#### Feed row

One event in a feed, newest first: time, action, id, then what happened.

- `eventRow(ev, titles)` in `ui/views/now.js`.
- Time from `clock()`, else `when()`. Action lower case. Id from `idLink()`.
- The row's colour from its action's tone; the live row stands out at the top.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Row | `--fs-xs` | | columns 55px, 70px, 64px, then the rest; padding `--sp-6`; rule `--rule-2` below |
| Time | `--mono` tabular | `--muted` | |
| Action | `--fw-mid` | its tone | |
| Id | `--mono` tabular | | one line |
| Title | | `--ink` | one line, ellipsis |
| What | | `--muted` | |
| Live row | | `--unstick-bg`, border `--unstick-ring` | radius `--r-card`, padding `--sp-8` `--sp-10` |

#### Findings list

The numbered findings of a Monitor report.

- `findingHtml(text)` in `ui/views/now.js`, one per `<li>` of an `<ol class="findings">`.
- In a closed fold whose summary gives the day and the count.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| List | line height 1.35 | `--ink-2` | indent 1.2em; `--sp-4` between items |

### Labels

#### Badge

A state, squared.

- `badge(state)` for a state; `priorityBadge(p)` for a priority.
- `tag(text, tone, title)` for other short status text.
- Text lower case, from Naming.
- A new state goes in the tone map of `tone()`, never as a class by hand.
- Never for a label.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Badge | `--fs-xs` `--fw-strong` | tone on its `-bg`: run, done, need, stuck; quiet `--muted` on `--sunk`; parked `--muted` outline | padding 1px `--sp-8`, radius `--r-tag`, one line |
| In an item card | `--fs-2xs` | | padding 1px 5px |

#### Chip

A label, a pill.

- `chips(labels)` for an item's labels.
- No labels: nothing, never a placeholder.
- Never for a state.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Chip | `--fs-xs`, line height 1.5 | `--ink-2` on `--sunk` | padding 0 7px, radius `--r-pill`, one line |

| Do | Don't |
|---|---|
| `badge("failed")` | a chip for a state |
| `chips(["ui", "css"])` for labels | a badge for a label |

### Actions

#### Button

An action on the server.

- `actButton(label, data, { primary, cls })`.
- `label`: a short verb in sentence case (`Retry`, `Land`).
- `data`: `act` and `path` for the dispatch in `ui/router.js`.
- At most one `primary` in a group.
- `cls: "warn"` for an action that stops or drops work.
- Land, Drop and Pause also take `confirm` (Two-click confirm).

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Button | `--sans` `--fs-sm` `--fw-mid` | `--ink` on `--surface`, border `--rule`; hover border `--ink-2` | `--ctl-h` high, padding `--sp-2` `--sp-12`, radius `--r-ctl` |
| Primary | | `--surface` on `--ink` | |
| Warn | | `--need` on `--need-bg`, border `--need`; only in the Status page head (Deviations) | |
| Asking | | `--need` on `--need-bg`, border `--need` | |
| Disabled | | opacity `--dim`, wait cursor | |

#### Link button

A link to another page, set as a button.

- For navigation only: Issue, Next sub-issue, Trace. An action on the server is a button.
- `<a class="act">` until a helper exists (Deviations).

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Link | as the button | as the button | no underline |

#### Command

A command for the reader to run.

- `cmd(text, { primary, hint })`.
- A click copies the text and says so.
- `primary` for the command the page asks for; at most one.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Box | `--mono` `--fs-sm` `--fw-mid` | `--ink` on `--sunk`, border `--rule`; hover border `--ink-2` | padding 7px `--sp-10`, radius `--r-ctl`; wraps anywhere |
| Primary | | `--surface` on `--ink` | |
| Hint | `--sans` `--fs-xs` | at .8 opacity | |
| Copy | `--sans` `--fs-xs` `--fw-mid` | at .7 opacity; 1 once copied | rule before it |
| Pressed | | | moves 1px down |

#### Row actions

A row's buttons.

- `.actions` after the row's text, never in a table cell.
- Buttons from `actButton()`; the result from `say()`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Row | | | gap `--sp-8`, `--sp-14` above; wraps |

#### Form message

The result of an action, beside its button.

- `say(el, text)`; it writes `.act-msg` with `role="alert"`.
- One line: what failed and why.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Message | `--fs-sm` | `--stuck` | centred on the button |

#### Two-click confirm

A second click for an action that is hard to undo.

- `confirm` in the button's `data`. The first click shows `<label> <name>? Click again` for 5 seconds (`ui/router.js`).
- An answer that needs a reason: a `.choice` with `input.reason`. The first click opens the box, and the button reads `Confirm`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Asking button | | `--need` on `--need-bg`, border `--need` | |
| Reason box | | | the full row |

#### Disclosure

A fold that hides detail.

- `<details>` with a `<summary>` that says what is inside.
- Closed by default, unless the reader came for what it holds.
- `data-keep="<key>"` keeps the reader's open state (`wireFolds()`, `restoreFolds()`); `recordState()` and `restoreState()` keep it across a redraw.
- A long list: `moreFold(items, row)`, 10 items, then a fold. Long text: `clamp(html)`, 3 lines, then Show more.
- Technical details at the end of a card: `details.more`, summary `Technical details`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Fold | | rule `--rule-2` above | `--sp-10` above, `--sp-8` padding |
| Summary | `--fs-sm` | `--ink-2` | |
| Marker | `--mono` | `--muted` | `+` closed, `−` open, 14px |
| Clamp | | | 3 lines; Show more at `--fs-xs` |

### Text

#### Markdown and code

- Markdown: `md()` into `.md`.
- Code in text: `codeText()`.
- A code block scrolls sideways in `.md`; elsewhere `pre` wraps.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Heading | `--sans` `--fs-lg` `--fw-strong` | | `--sp-14` above, `--sp-6` below |
| Inline code | `--mono` `--fs-xs` | | |
| Code block | `--mono` `--fs-xs`, line height 1.55 | on `--sunk` | padding `--sp-8` `--sp-10`, radius `--r-tag` |
| Table | `--fs-xs` | border `--rule` | padding `--sp-4` `--sp-8` |

#### Diff

- `diffHtml()` into `.diff-panel`; the panel scrolls.
- Added and deleted lines differ by colour alone (Accessibility).

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Panel | `--mono` `--fs-xs`, line height 1.5 | `--sunk`, border `--rule` | radius `--r-ctl`; 480px high at most, then scrolls |
| Added | | `--add` | |
| Deleted | | `--del` | |
| Hunk, meta | | `--muted` | |

### Controls

#### Filter bar

A row of filters over a table.

- `filterBar(groups)`. A fixed set of options is a segmented control; options from the data (`data: true`) are a select.
- The first option says All.
- A filter that changes the data: `goQuery()`. A filter that changes only what shows: `setQuery()`.
- Search: `searchBox()`.
- Filters for the whole page go in the page head, from `scope().bar()`.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Bar | | | wraps; gap `--sp-8` `--sp-18`; `--sp-12` below |
| Label | `--fs-xs` | `--muted` | `--sp-6` before its control |
| Segmented control | `--sans` `--fs-sm` | `--muted`, border `--rule`; hover `--ink` | `--ctl-h` high, radius `--r-ctl`; scrolls inside itself |
| Pressed segment | `--fw-strong` | `--ink` on `--rule-2` | |
| Select, search | | search on `--sunk` | `--ctl-h` high |

#### Pager

Rows past the first 50.

- `pager(shown, total)`: `Show 50 more`, then `50 of 345`.
- The limit lives in the address (`limitOf()`); `pagedTable()` reveals in place.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Pager | | | gap `--sp-12`, `--sp-10` above |
| Of | `--num` `--fs-xs` `--fw-mid` tabular | `--muted` | |

#### Empty state

What shows when there is nothing, while it loads, or when it failed.

- `empty(line, hint)`: one sentence on what is not there, then a hint on what to do.
- It takes the place of the table, chart or list; the card stays.
- Loading: `loading(title)` reads `Loading <title>…`.
- Failure: `error(line, hint)`; the hint says what to do.

| Part | Type | Colour | Space and shape |
|---|---|---|---|
| Line | | `--ink`; an error `--stuck` | `--sp-4` above |
| Hint | `--fs-sm` | `--muted` | `--sp-2` above |
| Loading | | `--muted` | |

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
| `.act.warn` has a style only in the Status page head, so a warn button elsewhere looks like any other | `ui/app.css` | review on `#/kit` |
| Sections built from `sectionHead()` with no card box | `ui/views/gates.js` (7), `ui/views/memory.js` (5), `ui/views/now.js` (4) | follow-up |
| Two box systems: the card pads with `--gap-in`, the detail panel with `--sp-14` and `--sp-18` | `ui/app.css` | review on `#/kit` |
| Folds written by hand: `details.more` 4 times, about 12 bare `<details>`; no helper | `ui/views/cards.js`, `ui/views/now.js`, `ui/views/sessions.js` | follow-up |
| Empty, loading and error lines written inline | `ui/views/now.js`, `ui/views/gates.js`, `ui/views/memory.js`, `ui/views/session.js`, `ui/views/ideas.js` | follow-up |
| Monitor findings built three ways; a feed row and a timeline event copied | `ui/views/now.js`, `ui/views/gates.js`, `ui/views/issues.js` | follow-up |
| The feed row's tones (`alert`, `warning`, `fine`) are its own, not `tone()` | `eventRow()` in `ui/views/now.js` | follow-up |
| Charts outside the chart panel: the Agent Time bar, the recall histogram, the session waterfall | `ui/views/speed.js`, `ui/views/memory.js`, `ui/views/session.js` | follow-up |
| One metric card written by hand (Backends) | `ui/views/factory-agents.js` | follow-up |
| A table written by hand | `ui/views/memory.js` | follow-up |
| The Status page head written by hand | `ui/views/now.js` | follow-up |
| An item card's meta row clips its badges to one letter in a narrow lane | `ui/app.css` | review on `#/kit` |
| Timeline axis labels overlap when two ticks are close | `renderTimeline()` in `ui/timeline.js` | review on `#/kit` |
| No helper for the status row or the link button | `ui/views/jobs.js`, `ui/views/issues.js`, `ui/views/memory.js` | follow-up |
| Two `act()` wrappers with different signatures; `shell()` has no callers | `ui/views/cards.js`, `ui/views/memory.js` | follow-up |
| A metric card's second value hides at phone width, so `v` shows with a `q` that names two values | `ui/app.css` | review on `#/kit` |
| A metric key on two lines pushes its value below the values of the cards beside it | `ui/app.css` | review on `#/kit` |

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
