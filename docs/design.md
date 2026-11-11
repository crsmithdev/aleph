# UI design language

The design language of `ui/`, read from the code by the design-language skill (`skills/design-language/SKILL.md`). It goes from principles to foundations to components. Each component has what it is, when to use it, its parts with their style, its rules, and Do and Don't pairs. A value the rules do not allow is a deviation, listed at the end.

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

These rules apply to all components. The section of a component adds its own rules.

- Build each component with its helper. Do not write its markup by hand.
- If a part has no helper, write it by hand and add a row to Deviations.
- Use tokens for all colours, sizes, spaces and radii (Principles, Rules).
- Format each value with its helper (Content, Values). Show a missing value as that table tells you.
- Get the colour of a state from `tone()`. Do not choose a tone by hand.
- Write headers and titles in Title Case, with short words in lower case (`Jobs per Item`). Write states in lower case.
- Show a count as a muted number after its title. Do not put a count in brackets.
- Give each control the states that States gives: `:focus-visible`, `aria-pressed`, and disabled while a request runs.
- When you add a component or a state, add a section here and a specimen on `#/kit`.

Each component has the same sections: what it is, when to use it, its parts, its rules, and Do and Don't pairs. The Style column gives the tokens that the helper applies. You do not set them.

### Structure

#### Page head

The page head is the first part of a page. It shows the title, a count, and the controls of the page.

**Use:** once on each page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Crumb | The path to the page. Detail pages only | `--mono` `--fs-sm`, `--muted`; a link is `--ink` on hover |
| 2 | Title | The name of the page | `--display` `--fs-xl`, `--ink` |
| 3 | Count | The number of items on the page. Optional | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| 4 | Controls | Project, window, then the controls of the page | `--fs-xs`, `--muted`; at the right; wraps |

- Make the head with `pageHead(title, { count, aside })`.
- Put the head first. On a detail page, put `crumb()` above it.
- On a list page, put the Project select and the window control in `aside`. Make them with `scope().bar()`. Put the controls of the page after them, in `after`.
- Keep the project and the window in the address. Call `scope().wire(root)` in `mount`.

#### Card

A card is one section of a list page. It has a head and a body.

**Use:** for each section of a list page. On a detail page, use the detail panel.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The section | `--surface`, border `--rule`, radius `--r-card`, padding `--gap-in` |
| 2 | Title | What the section holds | `--sans` `--fs-lg` `--fw-strong`, `--ink` |
| 3 | Count | The number of items. Optional | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| 4 | Aside | Controls, or one note. Optional | `--fs-xs`, `--muted`; at the right |
| 5 | Body | The content | `--fs-sm`, `--ink-2` |

- Make the card with `card(title, body, { count, aside, id })`.
- Do not put a card in a card.
- Give an `id` when a link goes to the section.
- When the section has no content, put `empty()` in the body. Keep the card.

#### Detail panel

A detail panel is one section of a detail page. It has a head and a body.

**Use:** for each section of an issue page or a job page. On a list page, use the card.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The section | `--surface`, border `--rule`, radius `--r-card` |
| 2 | Head | The title of the section | `--sans` `--fs-lg` `--fw-strong`, `--ink`; padding `--sp-14` `--sp-18` |
| 3 | Aside | A note or a control. Optional | `--fs-sm`, `--muted` |
| 4 | Body | The content | padding `--sp-10` `--sp-18` `--sp-14` |
| 5 | Code block | Logs or output. Optional | `--mono` `--fs-xs`, `--ink-2` on `--sunk`, radius `--r-tag`; scrolls at 70% of the screen height |

- For prose (Spec, Result, Description), use `panel(id, title, body, aside)` in `ui/timeline.js`.
- For a section that the reader can close, use `detailPanel(title, aside, body)` in `ui/timeline.js`.
- Make prose with `md()`. Keep prose at 80 characters wide or less.

#### KPI strip

The KPI strip shows the headline facts of a detail page in one row.

**Use:** once on a detail page, after the status row. On a list page, use metric cards.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Strip | The cells | the detail panel box; cells at 150px minimum, auto-fit |
| 2 | Key | The name of the fact | `--fs-xs`, `--muted` |
| 3 | Value | The fact | `--metric` `--fs-2xl` tabular; words: `--sans` `--fs-lg` |
| 4 | Sub | One line about the value. Optional | `--fs-xs`, `--muted` |

- Make the strip with `renderKpis([{ k, v, sub, text }])` in `ui/timeline.js`.
- Format each value with its helper. Set `text: true` when the value is words.
- On a phone, the cells stack.

#### Status row

The status row shows the state of the item on a detail page.

**Use:** once on a detail page, after the page head.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | State | The state of the item | a badge |
| 2 | Priority | The priority of the item | a priority badge |
| 3 | Labels | The part and the labels. Optional | chips |

- Put `badge()`, then `priorityBadge()`, then the chips, in a `div.status-row`.
- The row has no helper yet (Deviations).

#### Fact list

A fact list shows the keys and values of one item.

**Use:** for the properties of one item, or for the meta line of a row. Do not use a table of two columns.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Key | The name of the fact, in one or two words | `--fs-sm`, `--muted` |
| 2 | Value | The fact | `--num` tabular, `--ink-2` |

- Make the list with `facts([[key, html]])`.
- Write each key in sentence case (`Started`, `Took`).
- Format each value with its helper. The value is HTML: escape text with `esc()`.
- When a value is empty, `facts()` drops its row. Do not write a placeholder.

| Do | Don't |
|---|---|
| `facts()` | a two-column table of keys and values |

### Data

#### Metric card

A metric card shows one headline number of a list page, with its key.

**Use:** for the headline numbers of a list page. On a detail page, use the KPI strip.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The card | `--surface`, border `--rule`, radius `--r-card`, padding `--sp-12` `--sp-14` |
| 2 | Key | The measure, in two or three words | `--sans` `--fs-xs` `--fw-strong`, capitals, `--muted` |
| 3 | Trend | The change from the baseline. Optional | `--fs-sm` `--fw-strong`; `--good` when good, `--need` when bad, else `--muted` |
| 4 | Value | The number | `--metric` 700, up to `--fs-metric`, tabular, `--ink`; one line |
| 5 | Second value | A second number after ` / `, such as the cap. Optional | `--metric` at .62em, `--muted` |
| 6 | Bar | A meter. Optional | the meter |
| 7 | Qualifier | The names of the two values, or a note | `--fs-xs`; each name in the colour of its value; one line |

- Make the card with `statCard({ k, v, v2, q, note, trend, extra, href, key, on })`. Put the cards in `tiles(label, html)`.
- Write the key `k` in two or three words. The CSS sets it in capitals.
- Format the value `v` with its helper. When the value is unknown, write `–` and give a `note` that tells why.
- Use the second value `v2` only with `q`.
- Write `q` as two names, `[first, second]`: one name for each value. Write each name in lower case, in one word or a few words. Each name has the colour of its value.
- When the card has one value, write a `note` in place of `q`. Keep it to one line. The tooltip shows all of it.
- Make the trend only with `cardTrend(value, base, prev, { kind, lowerIsGood, format, basis })`. Set `kind` to `points` for a share, and to `relative` for a time or a count. Set `lowerIsGood` to `null` when no direction is good. When there is no baseline, show no trend.
- Put only a `meter()` in `extra`.
- Use `href` for a link to another page. Use `key` for a card that selects the view below it. Set `on` for the selected card, and connect it with `onTile()`.
- When a number needs more than these parts, put it in a table below the cards.

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | a `v2` with no `q` to name the two values |
| `q: ["in use", "cap"]` | `q: ["In Use", "Maximum Capacity"]` |
| `v: "–"` with a note that tells why | `v: "0"` for an unknown value |
| `statCard()` | card markup written by hand |
| the KPI strip on a detail page (`renderKpis()` in `ui/timeline.js`) | a metric card on a detail page |

#### Table

A table shows items that have the same columns.

**Use:** for a list of items. For the properties of one item, use a fact list.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Header | The name of each column | `--sans` `--fs-xs` `--fw-strong`, `--muted`; sorted column `--ink` |
| 2 | Cell | One value | `--fs-sm`, `--ink`; padding `--sp-6` `--sp-12` `--sp-6` 0; rule `--rule-2` below; one line |
| 3 | Title cell | The title of the item | takes the spare width, 16ch minimum; ends in an ellipsis |
| 4 | Number cell | A number | `--num` `--fw-mid` tabular; at the right |
| 5 | Sort arrow | `▲` or `▼` | `--fs-xs` |
| 6 | Row | One item | `--sunk` on hover |

- Make the table with `dataTable(head, rows, { fit })`. Make the head with `heads(labels, num)` or `sortHead()`.
- Put the columns in this order: time, id or name, title, state, project, labels, numbers.
- Format the time with `when()`. Name the time column for the time it shows (`Started`, `Updated`).
- Make an id with `idLink()` or `repoIdLink()`.
- Put the title in `td.wide`. Do not let other cells wrap.
- Show a state with `badge()` and labels with `chips()`.
- Put each number in `td.num`, and name its column in `num`.
- To sort, use `sortHead()` and `wireTable()`. Keep the sort in the address as `sort` and `dir`.
- When there are more than 50 rows, use `pagedTable()`, or `pager()` with `limitOf()`.
- For a short table of names and numbers, set `fit: true`.
- When there are no rows, show `empty()` in place of the table.
- Put the actions of a row in `.actions` under its text. Do not put a button in a cell.
- On a phone, the table scrolls sideways in `.tscroll`.

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed`: the time column says which time | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `.num`: right, tabular | numbers left-aligned |
| actions under a row's text (`.actions`) | a button in a table cell |

#### Chart panel

A chart panel is a card that draws a chart from a frame (`ui/chart.js`).

**Use:** for a value over time, or for values by category. For a share of one whole, use a meter.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The chart | the card box |
| 2 | Title | `<measure> by <dimension>`, from the frame | the card title |
| 3 | Form control | The forms of the chart | a segmented control in the aside |
| 4 | Legend | One item for each series. Optional | `--fs-xs`; at the top |
| 5 | Plot | The series | labels `--chart`, 12px times `--chart-scale`, `--chart-weight`, `--ink`; lines `--rule`; 200px high minimum |

- Make the panel with `panelOf(key, frame)` in `render`. Set the `frame` of the element in `mount`.
- Give each chart its own `key`, as `<view>/<chart>`.
- Set `measure.unit` to `count`, `usd` or `seconds`. The unit sets the format of the axis and the tooltip.
- Set `measure.agg` to `sum` for a flow, and to `max` for a level. A flow opens as Columns. A level opens as Area.
- Do not write the title. The frame gives it.
- Give each key in `by` a colour token: a tone for a state, `series-1` to `series-5` for a role. Keep the colour of a key the same in all windows.
- Show a legend. When the frame has one key and the title names it, set `legend: false`.
- When there is no data, the frame shows its `empty` line. When a card holds only a chart, show `empty()` in place of the panel.
- When the data did not rebuild, give `error` and `since`. The panel tells how old the data is.
- Put two or three panels side by side in `.trio`. Under 1100px, they stack.

| Do | Don't |
|---|---|
| `color: "done"` in a frame's `by` | a hex colour in a series |
| a legend on a stacked chart | a stacked chart with no legend |

#### Legend

A legend gives the colour of each series in a chart that is not a chart panel.

**Use:** with the timeline, or with a chart that you draw yourself. A chart panel has its own legend.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Item | The name of one series | `--fs-xs`, `--muted`; one row that wraps |
| 2 | Swatch | The colour of the series | its token; 10px square, radius `--r-hair` |

- Make the legend with `legendHtml([[label, cls]])`. The class `cls` sets the colour of the swatch.

#### Meter

A meter shows one share of a whole, or the segments of a whole.

**Use:** for a share of a known whole. For a value over time, use a chart panel.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Track | The whole | `--sunk`, `--bar-h` high, radius `--r-hair` |
| 2 | Fill | The share, or one segment | `--muted`; the largest row `--hot`; a segment its class |
| 3 | Mark | A target, or the time gone. Optional | `--ink`, 2px wide |

- Make the meter with `meter(parts, label, { mark })`. Give one percent, or segments as `{ pct, cls }`.
- Give a `label` as the text alternative. Leave it out only when the value shows next to the meter.
- Give the meter a width from its container. The meter has no width of its own.
- For rows of a label, a meter and a value, use `barRow()` in `barList()`. Set `top` on the largest row.

| # | Bar list part | Holds | Style |
|---|---|---|---|
| 1 | Label | The name of the row | `--fs-sm`, `--ink`; 80px to 200px |
| 2 | Value | The value of the row | tabular, `--ink-2`; at the right |
| 3 | Selected row | The row that `key` selects | `--sunk`; label `--fw-strong` |

#### Outcome bar

The outcome bar shows how the agent time of a window ended, by class.

**Use:** once on the Status page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Segment | The hours of one class | its `--seg-*` token; 28px high; the ends radius `--r-ctl` |
| 2 | Separator | The line between work that reached main and work that did not | `--ink-2`, 2px |
| 3 | Legend | The class, its hours and its share | `--fs-xs` tabular, `--ink-2`; numbers `--muted` |

- Make the bar with `bar(d, key)` in `ui/views/speed.js`, from `/api/flow`.
- Put the classes that reached main at the left of the separator.
- Each segment selects its detail below the bar, with `aria-pressed`.
- When there are no hours, show `empty()`.
- On a phone, the groups stack.

#### Timeline

The timeline shows the runs of an issue or a job over time, with their events.

**Use:** in a detail panel of an issue page or a job page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Axis | The times | `--fs-xs` tabular, `--muted` |
| 2 | Head | The name of the run | `--fs-sm`; 160px to 220px |
| 3 | Lane | The bars, waits and marks of the run | `--bg`, 22px high, radius `--r-tag` |
| 4 | Bar | One step of the run | `--fs-2xs` `--fw-mid`, `--on-fill` on its `--fill-*` token; 18px high |
| 5 | Wait | A time with no work | stripes of `--rule`; a wait for Chris: `--need` on `--need-bg` |
| 6 | Mark | A point in time | made `--muted`, done `--ink`; 2px wide |
| 7 | Result, time, cost | The end of the run | badge; `--fs-sm` tabular |
| 8 | Event | One event of the run | `--fs-sm`; time `--fs-xs` tabular `--muted` |

- Make the timeline with `renderTimeline(segments)` in `ui/timeline.js`.
- Give one row for each run.
- Give each bar a tone: `build`, `bad`, `land` or `aux`.
- Put the events of a run under its row. A long event is clamped.
- Put a legend from `legendHtml()` in the head of the panel.
- Under 740px, the timeline scrolls sideways.

### Lists of items

#### Item card

An item card shows one issue or one job in a lane.

**Use:** in a lane on the Status page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The item | `--surface`, border `--rule`, radius `--r-ctl`, padding `--sp-10` `--sp-12`; `--need` border when it waits for Chris |
| 2 | Kind edge | The kind of work | 4px at the left: land `--done`, worker `--run`, else `--rule` |
| 3 | Meta row | Id, state, kind, part, time, duration | `--fs-2xs`; 22px high; one line |
| 4 | Title | The title of the item, as a link | `--sans` `--fw-strong`; one line, ends in an ellipsis |

- Make the card with `laneCard()` in `ui/views/now.js`. Make the meta row with `metaRow()` in `ui/views/cards.js`.
- Put the short id of the item in `data-annotate`, so that a note stays on the item.

#### Ask card

An ask card asks Chris a question. It shows the question, the options and the buttons that answer it.

**Use:** for each Ask that waits for Chris.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Kind | approve, decide or unstick | sets the colour, `-bg` and `-ring` of the card (`--approve`, `--decide`, `--unstick`) |
| 2 | Box | The Ask | `--surface`, border the ring of the kind, shadow `--lift`, radius `--r-card` |
| 3 | Head | A dot, the kind, the title | `--fs-lg` on the `-bg` of the kind; kind `--fw-strong` in the colour of the kind |
| 4 | Question | The question, when the card is open | `--fs-lg` `--fw-strong`; 80ch maximum |
| 5 | Choices | One button for each answer | `--sp-8` apart; when open, a 200px column of buttons, then the text |
| 6 | Recommended | The mark on the recommended choice | `--fs-xs` `--fw-strong`, the colour of the kind |
| 7 | Details | Technical details. Optional | a closed fold |

- Make the card with `askCard(i)` in `ui/views/cards.js`.
- Make each button with `actButton()`. Mark the recommended choice.
- When a choice needs a reason, use the reason box of the two-click confirm.
- Put the technical details at the end, in a closed fold.

#### Lane

A lane is a column of item cards under a head with a count.

**Use:** for the Running, Queued and Done columns of the Status page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Head | The name of the lane and its count | the card title and count |
| 2 | Cards | The item cards | one column, `--sp-12` apart |
| 3 | Empty line | The line when the lane has no items | `--fs-sm`, `--muted` |

- Make the lane with `lane()` in `ui/views/now.js`.
- Put three lanes side by side in `.lanes`, `--sp-20` apart.

#### Feed row

A feed row shows one event in a feed. The newest event is first.

**Use:** in the feed of the Status page.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Time | The time of the event | `--mono` `--fs-xs` tabular, `--muted`; 55px |
| 2 | Action | What happened, in lower case | `--fw-mid`, the colour of its tone; 70px |
| 3 | Id | The item | `--mono` tabular; 64px; one line |
| 4 | Body | The title, then what happened | title `--ink`, one line; what `--muted` |
| 5 | Live row | The event in progress. Optional | `--unstick-bg`, border `--unstick-ring`, radius `--r-card` |

- Make the row with `eventRow(ev, titles)` in `ui/views/now.js`.
- Format the time with `clock()`, else `when()`. Make the id with `idLink()`.

#### Findings list

The findings list shows the numbered findings of a Monitor report.

**Use:** for a Monitor report, in a closed fold. The summary gives the day and the count.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Finding | One finding | `--ink-2`, line height 1.35; `--sp-4` apart |

- Make each finding with `findingHtml(text)` in `ui/views/now.js`, in one `<li>` of an `<ol class="findings">`.

### Labels

#### Badge

A badge shows a state. It has square corners.

**Use:** for a state or a priority. For a label, use a chip.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Badge | The state, in lower case | `--fs-xs` `--fw-strong`; radius `--r-tag`; one line |
| 2 | Tone | The colour of the state | run, done, need or stuck: the tone on its `-bg`; quiet: `--muted` on `--sunk`; parked: a `--muted` outline |

- Make a state badge with `badge(state)`, and a priority badge with `priorityBadge(p)`.
- For other short status text, use `tag(text, tone, title)`.
- Take the words of a state from Naming.
- When you add a state, add it to the tone map of `tone()`. Do not add a class by hand.
- In an item card, the badge is `--fs-2xs`.

#### Chip

A chip shows a label. It has round ends.

**Use:** for the labels of an item. For a state, use a badge.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Chip | One label | `--fs-xs`, `--ink-2` on `--sunk`; radius `--r-pill`; one line; 16ch maximum in a table |

- Make the chips with `chips(labels)`.
- When there are no labels, show nothing. Do not write a placeholder.

| Do | Don't |
|---|---|
| `badge("failed")` | a chip for a state |
| `chips(["ui", "css"])` for labels | a badge for a label |

### Actions

#### Button

A button starts an action on the server.

**Use:** for an action. For a link to another page, use the link button.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Button | A verb | `--sans` `--fs-sm` `--fw-mid`, `--ink` on `--surface`, border `--rule`; `--ctl-h` high; radius `--r-ctl`; border `--ink-2` on hover |
| 2 | Primary | The main action. Optional | `--surface` on `--ink` |
| 3 | Warn | An action that stops or drops work. Optional | `--need` on `--need-bg`, border `--need` (Status page head only, Deviations) |
| 4 | Disabled | A request in progress | opacity `--dim`, wait cursor |

- Make the button with `actButton(label, data, { primary, cls })`.
- Write the label as a short verb in sentence case (`Retry`, `Land`).
- Give `act` and `path` in `data`. `ui/router.js` sends the request.
- Use one `primary` button in a group, or none.
- Set `cls: "warn"` on an action that stops or drops work.
- For Land, Drop and Pause, add `confirm` (Two-click confirm).

#### Link button

A link button goes to another page. It looks like a button.

**Use:** for navigation only: Issue, Next sub-issue, Trace. For an action, use the button.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Link | The name of the page | the button style; no underline |

- Write `<a class="act" href="…">`. The link button has no helper yet (Deviations).

#### Command

A command box shows a command for the reader to run. A click copies it.

**Use:** for a command that the reader runs in a shell.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Box | The command | `--mono` `--fs-sm` `--fw-mid`, `--ink` on `--sunk`, border `--rule`, radius `--r-ctl`; wraps |
| 2 | Hint | A note on the command. Optional | `--sans` `--fs-xs` |
| 3 | Copy | The word `Copy` | `--sans` `--fs-xs`; a rule before it |
| 4 | Primary | The command that the page asks for. Optional | `--surface` on `--ink` |

- Make the box with `cmd(text, { primary, hint })`.
- Use one `primary` command on a page, or none.

#### Row actions

Row actions are the buttons of one row or one card.

**Use:** under the text of a row.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Row | The buttons and the form message | `--sp-8` apart, `--sp-14` above; wraps |

- Put the buttons in `.actions` after the text of the row.
- Do not put a button in a table cell.
- Show the result with `say()`.

#### Form message

A form message shows the result of an action, next to its button.

**Use:** after an action fails.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Message | What failed and why, in one line | `--fs-sm`, `--stuck` |

- Write the message with `say(el, text)`. It makes `.act-msg` with `role="alert"`.

#### Two-click confirm

The two-click confirm asks for a second click before an action that is hard to undo.

**Use:** for Land, Drop and Pause, and for an answer that needs a reason.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Asking button | `<label> <name>? Click again` | `--need` on `--need-bg`, border `--need` |
| 2 | Reason box | The reason. Optional | the full width of the row |

- Add `confirm` to the `data` of the button. The first click changes the label for 5 seconds (`ui/router.js`).
- For an answer that needs a reason, put the button in a `.choice` with an `input.reason`. The first click opens the box, and the label changes to `Confirm`.

#### Disclosure

A disclosure is a fold. It hides detail until the reader opens it.

**Use:** for detail that most readers do not need.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Fold | The detail | rule `--rule-2` above; `--sp-10` above |
| 2 | Summary | What the fold holds | `--fs-sm`, `--ink-2` |
| 3 | Marker | `+` when closed, `−` when open | `--mono`, `--muted` |

- Write a `<details>` with a `<summary>` that tells what the fold holds.
- Keep the fold closed, unless the reader came to the page for its content.
- To keep the state that the reader set, add `data-keep="<key>"` (`wireFolds()`, `restoreFolds()`). To keep it across a redraw, use `recordState()` and `restoreState()`.
- For a long list, use `moreFold(items, row)`: 10 items, then a fold.
- For long text, use `clamp(html)`: 3 lines, then Show more.
- At the end of a card, put technical details in `details.more` with the summary `Technical details`.

### Text

#### Markdown and code

Markdown shows prose. A code block shows code or output.

**Use:** for prose from a file or a note.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Heading | A heading of the prose | `--sans` `--fs-lg` `--fw-strong` |
| 2 | Inline code | A name or a value | `--mono` `--fs-xs` |
| 3 | Code block | Code or output | `--mono` `--fs-xs` on `--sunk`, radius `--r-tag`; scrolls sideways |
| 4 | Table | A table in the prose | `--fs-xs`, border `--rule` |

- Make prose with `md()` into `.md`.
- For code in a line of text, use `codeText()`.
- Outside `.md`, a `pre` wraps.

#### Diff

A diff shows the lines that a change adds and deletes.

**Use:** for the change of a job.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Panel | The diff | `--mono` `--fs-xs` on `--sunk`, border `--rule`, radius `--r-ctl`; 480px high maximum, then scrolls |
| 2 | Added line | A line that the change adds | `--add` |
| 3 | Deleted line | A line that the change deletes | `--del` |
| 4 | Hunk | The place of the change | `--muted` |

- Make the diff with `diffHtml()` into `.diff-panel`.
- Only colour shows the difference between added and deleted lines (Accessibility).

### Controls

#### Filter bar

A filter bar is a row of filters over a table.

**Use:** for the filters of one table. Put the filters of the whole page in the page head.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Label | The name of the filter | `--fs-xs`, `--muted` |
| 2 | Segmented control | A fixed set of options | `--sans` `--fs-sm`, `--muted`, border `--rule`, radius `--r-ctl`; `--ctl-h` high; scrolls inside itself |
| 3 | Pressed option | The option in use | `--fw-strong`, `--ink` on `--rule-2` |
| 4 | Select | Options from the data | `--ctl-h` high |
| 5 | Search | Text to search for. Optional | on `--sunk`; `--ctl-h` high |

- Make the bar with `filterBar(groups)`. For options from the data, set `data: true` to get a select.
- Make the first option `All`.
- When a filter changes the data, use `goQuery()`. When it changes only what shows, use `setQuery()`.
- Make the search field with `searchBox()`.

#### Pager

A pager shows the rows after the first 50.

**Use:** under a table of more than 50 rows.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Button | `Show 50 more` | the button |
| 2 | Count | `50 of 345` | `--num` `--fs-xs` `--fw-mid` tabular, `--muted` |

- Make the pager with `pager(shown, total)`.
- Keep the limit in the address with `limitOf()`. To show the rows in place, use `pagedTable()`.

#### Empty state

An empty state shows that there is nothing, that data loads, or that the data did not load.

**Use:** in place of a table, a chart or a list that has nothing to show.

| # | Part | Holds | Style |
|---|---|---|---|
| 1 | Line | What is not there, in one sentence | `--ink`; an error `--stuck` |
| 2 | Hint | What to do | `--fs-sm`, `--muted` |
| 3 | Loading | `Loading <title>…` | `--muted` |

- Make the empty state with `empty(line, hint)`. Keep the card around it.
- Make the loading line with `loading(title)`.
- Make a failure with `error(line, hint)`. The hint tells the reader what to do.

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
| The Ideas page head has no Project select | `ui/views/ideas.js` | follow-up |
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
