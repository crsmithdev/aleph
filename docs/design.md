# UI design language

The design language of `ui/`, read from the code by the design-language skill (`skills/design-language/SKILL.md`). It goes from principles to foundations, content and components, then to states and layout. A value that the rules do not allow is a deviation, listed at the end.

The Kit page, `#/kit` (`ui/views/kit.js`), draws each token and component with its own helper from fixture data, in light and dark, and shows each component's section beside its specimen. A new component gets a section here and a specimen there.

## Principles

1. **One token set, two themes.** Colours are custom properties on `:root` in `ui/app.css`, set again for dark by `@media (prefers-color-scheme: dark)` and by `:root[data-theme="dark"]`. A view that uses only tokens gets dark mode free. Light is lavender; dark is Palenight.
2. **Shared helpers build the parts.** Views call `ui/lib.js`; the CSS is in `ui/app.css`. A fix in one helper fixes every page.
3. **Meaning is a tone.** `run`, `done`, `need`, `stuck`, `quiet` or `parked`, from `tone()` in `ui/lib.js`. One state has one colour on a badge, a series and a card, so a reader learns it once.
4. **Numbers are tabular.** Tabular figures, at the right, so digits line up in a column.
5. **Plain text states.** An empty state is one sentence and a hint. A missing value is what its helper shows (Content, Values), never `N/A` or `0`.

### Rules

| Use | For |
|---|---|
| a colour token; in a chart, a token that `readTokens()` reads (`TOKENS` in `ui/lib.js`) | every colour |
| `--fs-*`, `--r-*`, `--sp-*`, `--dim`, `--ctl-h`, `--bar-h` | sizes, radii, spacing, dimming, heights |
| the helpers in Content, Values | every displayed value |

| Do | Don't |
|---|---|
| `color: var(--muted)` | `color: #62688A` |
| `font-size: var(--fs-sm)` | `font-size: 13px` |
| `padding: var(--sp-6) var(--sp-10)` | `padding: 6px 10px` |
| `dur(245)` | `` `${Math.floor(s / 60)}m` `` |
| `@media (max-width: 720px)` | `@media (max-width: 800px)` |

Allowed literals: the `#000` masks of `.chat .clamp` and `.wf-detail .clamp`, and the `color-mix()` of `.cmd .cp`, all in `ui/app.css`.

Allowed size literals: a width, a height, a position offset, a 1px hairline, and an `em`, `ch`, `%` or `vh` value. A padding, margin, gap or scroll-padding outside `:root` is `0`, `1px`, or built from `--sp-*` and `--gap`. A value above `--sp-28` is a `calc()` of tokens, such as `calc(2 * var(--gap))` for 48px.

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
| `--muted` | #62688A | #9AA2C6 | headers, meta |
| `--rule`, `--rule-2` | #DCD9EC, #E8E6F3 | #3A3F58, #2E3245 | borders, row lines |
| `--lift` | `0 1px 3px`, `0 2px 8px` | heavier | the Ask card |
| `--card-lift` | `0 1px 2px`, `0 6px 20px -8px` | heavier | the only edge of a card, a metric card and a detail panel |
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
| `--series-1` to `--series-5` | #2A78D6, #EB6834, #169A69, #C28000, #DC5F92 | #3987E5, #D95926, #199E70, #C98500, #D55181 | agent roles in charts |
| `--chart-6`, `--chart-7` | #7E57C2, #0E7C9E | #A079DC, #2398B8 | extra series |
| `--seg-landed`, `-returned`, `-failed`, `-reran`, `-dropped` | `--seg-landed` in `ui/app.css` | not set again | outcome bar, under white text |
| `--fill-run`, `--fill-stuck`, `--fill-done`, `--fill-aux` | `--fill-run` in `ui/app.css` | not set again | timeline bar fills, under white text |

| Do | Don't |
|---|---|
| a tone for a state: `--stuck` on a failed job | a tone for decoration |
| `--series-*` for roles, the same role in the same colour on every chart | a new colour per chart |
| an eighth key folded into `Other` | a colour made for an eighth key |
| a value or a label in `--ink` next to its swatch | a value in the colour of its series |
| text on its own `-bg`: `--need` on `--need-bg` | `--need` on `--stuck-bg` |

#### Contrast

The minimum is 4.5:1 for text and 3:1 for a mark. `ui/stuck-contrast.test.ts` tests the stuck pair and the dark `--muted` pairs. When you change a data colour, run `validate_palette.js` from the `dataviz` skill on the seven series colours, once with `--mode light --surface "#FFFFFF"` and once with `--mode dark --surface "#292D3E"`. Deviations lists the checks that fail now.

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--surface` | 13.64 | 12.07 |
| `--ink-2` on `--surface` | 8.02 | 8.02 |
| `--muted` on `--surface` | 5.43 | 5.43 |
| `--muted` on `--bg` | 4.93 | 6.21 |
| `--muted` on `--sunk` | 4.57 | 6.75 |
| `--muted` on `--raised` | 4.57 | 4.67 |
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
| `--fs-2xl` | 20px | brand mark, KPI value |
| `--fs-xl` | 26px | page title |
| `--fs-metric` | 32px | metric value |

#### Weights and families

| Token | Value | Role |
|---|---|---|
| `--fw-text` | 400 | text |
| `--fw-mid` | 500 | ids, numbers |
| `--fw-strong` | 600 | headings, table headers |
| `--sans`, `--mono`, `--num`, `--display`, `--metric`, `--brand` | Work Sans, Hack Nerd Font, Merriweather | body, code, numbers, titles; `--metric` is Work Sans |
| `--chart` | `--sans` | the font of text in the ECharts canvas |
| `--chart-scale`, `--chart-weight` | 1, 400 | text in the ECharts canvas: its relative size and weight |

Weight 700 stays a literal on `.mark`.

#### Tracking and line height

| Proposed token | Value | Uses | Where |
|---|---|---|---|
| `--ls-display` | `-0.02em`; `.mark` keeps `-0.01em` | 4 | `.mark`, `.shead .say`, `.shead .asof`, `.ph h1` |
| `--ls-caps` | one tracking for uppercase keys | 4 (`.05em`, `.06em`, `.08em`); `.tile .k` is `.05em` | `#nav li.head`, `.tile .k`, `.herald-sticky-head`, `.ins h4` |

| Do | Don't |
|---|---|
| `line-height: 1.45` | `line-height: 20px` |
| uppercase on the small keys that `--ls-caps` lists | uppercase on a section heading |

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
| `--r-card` | 12px | cards |
| `--r-ctl` | 6px | controls |
| `--r-tag` | 4px | badges, code blocks |
| `--r-hair` | 2px | bars, marks |
| `--r-pill` | 999px | chips |

#### Controls and layers

| Token | Value | Role |
|---|---|---|
| `--ctl-h` | 28px; 40px on a touch screen (`pointer: coarse`) | control height |
| `--bar-h` | 10px | `.meter` and `.wf-bar` height |
| `--dim` | .6 | opacity of a dimmed control |
| `--z-rowlink` | 1 | `tr.rowlink` links |
| `--z-sticky` | 2 | sticky bar, waterfall axis |
| `--z-overlay` | 50 | kit widgets: font picker, annotations |

A selected or parked item has a `box-shadow: inset` ring.

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

Every displayed value goes through its helper in `ui/lib.js`. The Missing column gives what the helper shows for no value. Show that; do not replace it.

| Kind | Example | Helper | Missing |
|---|---|---|---|
| Absolute time | 10/28 14:05 | `when()` | empty |
| Day | Oct 28 | `day()` | empty |
| Axis hour | 4a, 1:36p | `hourLabel()`, axes only | none |
| Clock | 14:05 | `clock()` | empty |
| Duration from seconds | 43s, 4m 05s, 1h 02m, 2d 04h | `dur(seconds)` | `–` |
| Duration from milliseconds | 850ms, 1.2s | `durMs(ms)` | empty |
| Duration between two times | 4m 05s | `span(from, to)` | empty |
| Cost | $1.25, <$0.01 | `money()` | `$0.00` |
| Weekly share | ≈1% wk, ≈0.4% wk | `wkText()` | empty |
| Percent | 12%, 0.4%, <0.1% | `pct(0 to 100)` | `–` |
| Count | 12,345 | `count()` | `–` |
| Id | a52 | `idLink()`, `repoIdLink()`; see [Naming](naming.md) | none |
| Model | opus | `shortModel()` | empty |
| Bytes | 1.5KiB | `bytes()` | none |
| Mean | 2.4 | `mean()` | `–` |
| Hours | 3.2h, 12h | `hours()` | `–` |
| Days | 12d | `days()` | `–` |

| Do | Don't |
|---|---|
| `850ms`, `3.2h` | `850 ms`, `3.2 h` |
| `4m 05s` | `4:05`, `245s` |
| `10/28 14:05` | `Oct 28, 2:05 PM` |
| `opus` | `claude-opus-4-5` |
| `–` | `N/A`, `0`, `-` |

### Words

- Write a page title, a section title and a column header in Title Case. Write these words in lower case, unless they are first: a, an, the, and, but, or, nor, as, at, by, for, from, in, of, on, per, to, vs, with.
- Write a key of a fact list and the label of a button in sentence case.
- Write a state, a priority and a chart key in lower case. States come from [Naming](naming.md); priorities are `critical`, `high`, `medium`, `low`.
- Show a count as a muted number after its title, not in brackets.
- Write an empty state as one sentence, then a hint that tells the reader what to do.
- Offline, the page says "The server is unreachable. Showing the last data." (`ui/index.html`).

| Do | Don't |
|---|---|
| `Jobs per Item`, `Linked from` | `Jobs Per Item`, `jobs per item`, `Linked From` |
| `Running` with a muted `3` after it | `Running (3)` |
| `Show 50 more` | `Click here to load more results` |
| `running`, `landed`, `critical` | `Running`, `LANDED` |
| `No job matches.` with the hint `Widen the window or clear a filter.` | `No data` |
| `The agents did not load.` with the hint `Check that aleph-ui is running, then reload.` | `Error: fetch failed` |
| `Loading Jobs…` | a spinner with no text |

## Components

### Every component

These rules apply to all components. The section of a component adds only its own rules.

- Build each component with its helper. Do not write its markup by hand.
- If a part has no helper, write it by hand and add a row to Deviations.
- Use tokens for all colours, sizes, spaces and radii (Principles, Rules).
- Format each value with its helper, and show a missing value as Content, Values gives.
- Write titles, keys, labels and counts as Content, Words gives.
- Get the colour of a state from `tone()`. Do not choose a tone by hand.
- When a component on a list page has nothing to show, put `empty()` in its place. Keep the card around it. On a detail page, leave the panel out.
- Give each control the states that States gives.
- Give text that can end in an ellipsis its full text in `title`. Give a control with only an icon an `aria-label` and the same `title`.
- When you add a component or a state, add a section here and a specimen on `#/kit`.

Each section below has the same parts, in this order:

1. One sentence on what the component is.
2. **Use** and **Not for**: when to use it, and what to use in its place.
3. **Helper** and **Reference**: the function that builds it, and the view that follows the rules best.
4. **Parts**: each part, what it holds, whether it is optional, and its style. The helper applies the style. You do not set it.
5. **Rules**: how to build it, then what it holds, how it behaves, and how it shows on a phone.
6. **Do and Don't**: examples.

### Structure

#### Page head

The page head is the first part of a page. It shows the title, a count and the controls of the page.

**Use:** once at the top of each page. **Not for:** a section title; use the card.

| Helper | Reference |
|---|---|
| `pageHead(title, { count, aside })`; `crumb(back, parts)`; `scope().bar({ after })` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Crumb | The path to the page | yes; detail pages only | `--mono` `--fs-sm`, `--muted`; a link is `--ink` on hover |
| 2 | Title | The name of the page | | `--display` `--fs-xl`, `--ink` |
| 3 | Count | The number of items on the page | yes | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| 4 | Controls | The Project select, the window, then the controls of the page | yes | `--fs-xs`, `--muted`; at the right; wraps |

- On a detail page, put `crumb()` above the head.
- On a list page, make the controls with `scope().bar()` and put them in `aside`. The bar starts with the Project select and the window. Give the controls of the page to the bar as `after`.
- A detail page has no Project select.
- Keep the project and the window in the address: call `scope().wire(root)` in `mount`.

| Do | Don't |
|---|---|
| `pageHead("Jobs", { count: 128, aside: scope().bar() })` | `<h1>Jobs (128)</h1>` |
| Project, window, then the controls of the page | a control of the page before the Project select |

#### Card

A card is one section of a list page. It has a head and a body.

**Use:** for each section of a list page. **Not for:** a section of a detail page; use the detail panel.

| Helper | Reference |
|---|---|
| `card(title, body, { count, aside, id })` | `ui/views/factory-agents.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The section | | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card`, padding `--gap-in` |
| 2 | Title | What the section holds | | `--sans` `--fs-lg` `--fw-strong`, `--ink` |
| 3 | Count | The number of items | yes | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| 4 | Aside | Controls, or one note | yes | `--fs-xs`, `--muted`; at the right |
| 5 | Body | The content | | `--fs-sm`, `--ink-2` |

- Do not put a card in a card.
- Give an `id` when a link goes to the section.

| Do | Don't |
|---|---|
| `card("Recent Jobs", dataTable(…), { count: 12 })` | a section head with no box (`sectionHead()` alone) |
| `card("Recent Jobs", empty("No job ran in this window."))` | no card when the section is empty |

#### Detail panel

A detail panel is one section of a detail page. It has a head and a body.

**Use:** for each section of an issue page or a job page. **Not for:** a section of a list page; use the card.

| Helper | Reference |
|---|---|
| `panel(id, title, body, aside)` and `detailPanel(title, aside, body)` in `ui/timeline.js` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The section | | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card` |
| 2 | Head | The title of the section | | `--sans` `--fs-lg` `--fw-strong`, `--ink`; padding `--sp-14` `--sp-18` |
| 3 | Aside | A note; in `detailPanel()`, text or a badge only | yes | `--fs-sm`, `--muted` |
| 4 | Body | The content | | `detailPanel()`: padding `--sp-10` `--sp-18` `--sp-14`; `panel()`: the padding of its `.md` |
| 5 | Code block | Logs or output | yes | `--mono` `--fs-xs`, `--ink-2` on `--sunk`, radius `--r-tag`; scrolls at 70% of the screen height |

- For prose (Spec, Result, Description), use `panel()`. Wrap the prose in `<div class="md">`: that wrapper gives the padding and the 80ch width.
- For a section that the reader can close, use `detailPanel()`. It is open at first. Its aside is inside the summary, so a click there opens or closes the panel: put controls in the body.
- When a section has no content, leave the panel out.

| Do | Don't |
|---|---|
| `panel("spec", "Spec", `<div class="md">${md(text)}</div>`)` | `card("Spec", …)` on a job page |
| `detailPanel("Review", "2 notes", body)` | a `<details>` written by hand for a section |

#### KPI strip

The KPI strip shows the headline facts of a detail page.

**Use:** once on a detail page. **Not for:** a list page; use metric cards.

| Helper | Reference |
|---|---|
| `renderKpis([{ k, v, sub, text }])` in `ui/timeline.js` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Strip | The cells | | the detail panel box; cells 150px minimum, auto-fit |
| 2 | Key | The name of the fact | | `--fs-xs`, `--muted` |
| 3 | Value | The fact | | `--metric` `--fs-2xl` tabular; words: `--sans` `--fs-lg` |
| 4 | Sub | One line about the value | yes | `--fs-xs`, `--muted` |

- `v` and `sub` are HTML: escape text with `esc()`.
- Set `text: true` when the value is words, not a number.
- Give at most 6 cells. The cells wrap at every width, 150px minimum each.

| Do | Don't |
|---|---|
| `{ k: "Took", v: dur(245) }` | `{ k: "Took", v: "245s" }` |
| `{ k: "Model", v: "opus", text: true }` | words in the number font |

#### Status row

The status row shows the state of the item on a detail page.

**Use:** once on a detail page, under the page head. **Not for:** a list page; a row of a table shows its own state.

| Helper | Reference |
|---|---|
| `statusRow()` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | State | The state of the item | | a badge |
| 2 | Priority | The priority of the item | | a priority badge |
| 3 | Labels | The part and the labels | yes | chips |

- Put the parts in this order: state, priority, labels.

| Do | Don't |
|---|---|
| `statusRow(badge("running"), priorityBadge("high"), chips(["ui"]))` | the state as words in a sentence |

#### Fact list

A fact list shows the keys and values of one item.

**Use:** for the properties of one item, or for the meta line of a row. **Not for:** many items; use a table.

| Helper | Reference |
|---|---|
| `facts([[key, html]])` | `ui/views/session.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Key | The name of the fact, in one or two words | | `--fs-sm`, `--muted` |
| 2 | Value | The fact | | `--num` tabular, `--ink-2` |

- The value is HTML: escape text with `esc()`.
- When a value is empty, `facts()` drops its row. Do not write a placeholder.

| Do | Don't |
|---|---|
| `facts([["Started", when(t)], ["Took", dur(s)]])` | a two-column table of keys and values |
| `["Model", esc(name)]` | `["Model", name]` with text that is not escaped |

### Data

#### Metric card

A metric card shows one headline number of a list page, with its key.

**Use:** for the headline numbers of a list page. **Not for:** a detail page; use the KPI strip. A number that needs more than these parts goes in a table under the cards.

| Helper | Reference |
|---|---|
| `statCard({ k, v, v2, q, note, trend, extra, href, key, on })` in `tiles(label, html)`; `cardTrend()`; `onTile()` | `statusCards()` in `ui/views/speed.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The card | | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card`, padding `--sp-12` `--sp-14` |
| 2 | Key `k` | The measure | | `--sans` `--fs-xs` `--fw-strong`, capitals, `--muted`; breaks only between words, and moves the trend to the next line when the two do not fit |
| 3 | Trend | The change from the baseline | yes | `--fs-sm` `--fw-strong`, a pill (radius `--r-pill`); `--good` on `--done-bg` when good, `--need` on `--need-bg` when bad, else `--muted` on `--sunk` |
| 4 | Value `v` | The number | | `--metric` `--fw-strong`, `-0.025em`, up to `--fs-metric`, tabular, `--ink`; one line |
| 5 | Second value `v2` | A second number after ` / `, such as the cap | yes | `--metric` at .62em, `--muted` |
| 6 | Bar `extra` | A meter | yes | the meter |
| 7 | Qualifier `q` or `note` | The names of the two values, or a note | | `--fs-xs`; one line; first name `--ink`, second `--muted` |

- Write the key in two or three words. The CSS sets it in capitals.
- When the value is unknown, write `–` and give a `note` that tells why.
- With `v2`, give `q` as `[first, second]`: one name for each value, in lower case, in one word or a few words.
- With no `v2`, give a `note` in place of `q`. The tooltip shows all of the note.
- Make the trend only with `cardTrend(value, base, prev, { kind, lowerIsGood, format, basis })`. Set `kind` to `points` for a share, and to `relative` for a time or a count. Set `lowerIsGood` to `null` when no direction is good. With no baseline, `cardTrend()` shows nothing.
- Put only a `meter()` or a column of status lights in `extra`.
- For a link to another page, give `href`. For a card that selects the view under it, give `key`, set `on` on the selected card, and connect the cards with `onTile()`.

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | `v2` with no `q` |
| `q: ["in use", "cap"]` | `q: ["In Use", "Maximum Capacity"]` |
| `k: "Worker slots"` | `k: "Worker slots in use right now"` |
| `v: "–"` with a note that tells why | `v: "0"` for an unknown value |

#### Table

A table shows items that have the same columns.

**Use:** for a list of items. **Not for:** the properties of one item; use a fact list.

| Helper | Reference |
|---|---|
| `dataTable(head, rows, { fit })`; `heads(labels, num)`, `sortHead()`, `wireTable()`; `pagedTable()` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Header | The name of each column | | `--sans` `--fs-xs` `--fw-strong`, `--muted`; the sorted column `--ink` |
| 2 | Cell | One value | | `--fs-sm`, `--ink`; padding `--sp-6` `--sp-12` `--sp-6` 0; rule `--rule-2` below; one line |
| 3 | Title cell `td.wide` | The title of the item | | takes the spare width, 16ch minimum; ends in an ellipsis |
| 4 | Number cell `td.num` | A number | | `--num` `--fw-mid` tabular; at the right |
| 5 | Sort arrow | `▲` or `▼` | yes | `--fs-xs` |
| 6 | Row | One item | | `--sunk` on hover |
| 7 | Row actions | The buttons of the row | yes | the row actions |

- Put the columns in this order: id or name, title, time, state, priority, project, labels, then numbers.
- Put each number at the right of the row. Align a number to the right.
- Name the time column for the time it shows. Format it with `when()`.
- Make an id with `idLink()` or `repoIdLink()`, a state with `badge()`, and labels with `chips()`.
- Put the title in `td.wide`. Do not let other cells wrap.
- Put each number in `td.num`. For `heads()`, list the column's label in `num`. For `sortHead()`, pass `{ num: true }`.
- Put the time in `td.time`.
- When a row goes to a page, make it `tr.rowlink` and put the link in `td.wide`.
- To sort, use `sortHead()` and `wireTable()`. Keep the sort in the address as `sort` and `dir`.
- When there are more than 50 rows, use `pagedTable()`, or `pager()` with `limitOf()`.
- For a short table of names and numbers, set `fit: true`.
- On a phone, the table scrolls sideways in `.tscroll`.

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed` | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `td.num` | numbers at the left |

#### Chart panel

A chart panel is a card that draws a chart from a frame (`ui/chart.js`).

**Use:** for a value over time, or for values by category. **Not for:** a share of one whole; use a meter. A single value; use a metric card.

| Helper | Reference |
|---|---|
| `panelOf(key, frame)` in `ui/chart.js` | `ui/views/factory-agents.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The chart | | the card box |
| 2 | Title | `<measure> by <dimension>`, from the frame | | the card title |
| 3 | Form control | The forms of the chart | | a segmented control in the aside |
| 4 | Legend | One item for each series | yes | `--fs-xs`; at the top |
| 5 | Plot | The series | | labels `--chart`, 12px times `--chart-scale`, `--chart-weight`, `--ink`; lines `--rule`; 200px high minimum |

- Call `panelOf()` in `render`. Set the `frame` of the element in `mount`.
- Give each chart its own `key`, as `<view>/<chart>`.
- Do not write the title. The frame gives it.
- Set `measure.unit` to `count`, `usd` or `seconds`. The unit sets the format of the axis and the tooltip.
- Set `measure.agg` to `sum` for a flow, and to `max` for a level. A flow opens as Columns. A level opens as Area.
- Show one measure on one value axis. For two measures, use two panels.
- A key in `by` with no `color` takes the next of `series-1` to `series-5`, `chart-6`, `chart-7`, by its place among the keys with a value. For a state, set `color` to its tone: `run`, `done`, `need` or `stuck`. Other allowed values: `hot`, `muted`, `series-1` to `series-5`, `chart-6`, `chart-7`. `quiet` and `parked` are not chart colours.
- Keep the colour of a key the same in all windows. If a key can have no value in a window, set `color` on each key, because the keys after it move up one colour.
- Show at most seven keys. Fold the rest into one key, `Other`.
- Show a legend. When the frame has one key and the title names it, set `legend: false`.
- When there is no data, the frame shows its `empty` line.
- When the data did not rebuild, give `error` and `since`. The panel tells how old the data is.
- Put two or three panels side by side in `.trio`, which has three columns. With two panels, give one the class `wide`: `panelOf(key, frame, "wide")`. Under 1100px, they stack.

| Do | Don't |
|---|---|
| `color: "done"` in a frame's `by` | a hex colour in a series |
| a legend on a stacked chart | a stacked chart with no legend |
| `panelOf("agents/cost", frame)` | an ECharts instance made by the view |

Two charts are allowed outside the chart panel: the Agent Time bar (`ui/views/speed.js`) and the session waterfall (`ui/views/session.js`).

#### Legend

A legend gives the colour of each series in a chart that is not a chart panel.

**Use:** with a chart that you draw yourself from the timeline classes. **Not for:** a chart panel or the timeline; each has its own legend.

| Helper | Reference |
|---|---|
| `legendHtml([[label, cls]])` | `ui/timeline.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Item | The name of one series | | `--fs-xs`, `--muted`; one row that wraps |
| 2 | Swatch | The colour of the series | yes | its `t-*` class; 14px by 8px, radius `--r-hair`; a mark (`t-made`, `t-done`) is 2px by 12px |

- Set `cls` to a timeline class: `t-build`, `t-bad`, `t-land`, `t-aux`, `t-wait`, `t-chris`, `t-made` or `t-done`. With no `cls`, the item has no swatch.
- Put the legend in the aside of the panel that holds the chart.

| Do | Don't |
|---|---|
| `legendHtml([["build", "t-build"], ["land", "t-land"]])` | a legend with colours set inline |

#### Meter

A meter shows one share of a whole, or the segments of a whole.

**Use:** for a share of a known whole. **Not for:** a value over time; use a chart panel.

| Helper | Reference |
|---|---|
| `meter(parts, label, { mark })`; `barRow(label, pct, value, { top, key, on })` in `barList(rows)` | `ui/views/memory.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Track | The whole | | `--sunk`, `--bar-h` high, radius `--r-hair` |
| 2 | Fill | The share, or one segment | | `--muted`; the largest row `--hot`; a segment its class |
| 3 | Mark | A target, or the time gone | yes | `--ink`, 2px wide |
| 4 | Bar list label | The name of the row | bar list only | `--fs-sm`, `--ink`; 80px to 200px |
| 5 | Bar list value | The value of the row | bar list only | tabular, `--ink-2`; at the right |
| 6 | Selected row | The row that `key` selects | yes | `--sunk`; label `--fw-strong` |

- Give one percent, or segments as `{ pct, cls }`.
- Give a `label` as the text alternative. Leave it out only when the value shows next to the meter.
- The meter has no width of its own. Its container gives it one.
- For rows of a label, a meter and a value, use `barRow()` in `barList()`. Set `top` on the largest row.

| Do | Don't |
|---|---|
| `meter(42, "42% used")` | a meter with no label and no value next to it |
| `barRow(…, { top: true })` on the largest row | `--hot` set by hand |

#### Outcome bar

The outcome bar shows how the agent time of a window ended, by class.

**Use:** once on the Status page. **Not for:** other data; use a meter or a chart panel.

| Helper | Reference |
|---|---|
| `bar(d, key)` in `ui/views/speed.js`, from `/api/flow` | `ui/views/speed.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Segment | The hours of one class | | its `--seg-*` token; 28px high; the ends radius `--r-ctl` |
| 2 | Separator | The line between work that reached main and work that did not | | `--ink-2`, 2px |
| 3 | Legend | The class, its hours and its share | | `--fs-xs` tabular, `--ink-2`; numbers `--muted` |

- Put the classes that reached main at the left of the separator.
- Each segment selects its detail under the bar, with `aria-pressed`.
- On a phone, the groups stack.

| Do | Don't |
|---|---|
| `--seg-landed` on the landed segment | a tone token on a segment |

#### Timeline

The timeline shows the runs of an issue or a job over time, with their events.

**Use:** once on an issue page or a job page. It makes its own panel. **Not for:** values over time; use a chart panel.

| Helper | Reference |
|---|---|
| `renderTimeline(segments)`, `laneRow()` in `ui/timeline.js` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Axis | The times | | `--fs-xs` tabular, `--muted` |
| 2 | Head | The name of the run | | `--fs-sm`; 160px to 220px |
| 3 | Lane | The bars, waits and marks of the run | | `--bg`, 22px high, radius `--r-tag` |
| 4 | Bar | One step of the run | | `--fs-2xs` `--fw-mid`, `--on-fill` on its `--fill-*` token; 18px high |
| 5 | Wait | A time with no work | yes | stripes of `--rule`; a wait for Chris: `--need` on `--need-bg` |
| 6 | Mark | A point in time | yes | made `--muted`, done `--ink`; 2px wide |
| 7 | Result, time, cost | The end of the run | | badge; `--fs-sm` tabular |
| 8 | Event | One event of the run | yes | `--fs-sm`; time `--fs-xs` tabular `--muted` |

- `renderTimeline()` makes the whole panel: its title, its legend and its rows. Do not wrap it, and do not add a legend.
- Give `segments` as `[{ title, aside, rows }]`. Make each row with `laneRow()`. It sets the tones of the bars, the waits, the time and the cost from the runs. Do not set a tone by hand.
- Put the events of a run under its row. A long event is clamped.
- With no rows, `renderTimeline()` shows nothing.
- Under 740px, the timeline scrolls sideways.

| Do | Don't |
|---|---|
| `renderTimeline(segments)` on its own | `detailPanel("Timeline", legendHtml(…), renderTimeline(…))` |

### Lists of items

#### Item card

An item card shows one issue or one job in a lane.

**Use:** in a lane on the Status page. **Not for:** a list page; use a table.

| Helper | Reference |
|---|---|
| `renderLanes(s)` in `ui/views/now.js`, which makes the lanes and their cards; `metaRow()` in `ui/views/cards.js` | `ui/views/now.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The item | | `--surface`, border `--rule`, radius `--r-ctl`, padding `--sp-10` `--sp-12` |
| 2 | Meta row | Id, state, kind, part, time, duration | | `--fs-2xs`; 22px high; one line; badges `--fs-2xs` |
| 3 | Title | The title of the item: a link when the item has a page, else text | | `--sans` `--fw-strong`; one line, ends in an ellipsis |
| 4 | Hold | Why the item waits, and what blocks it | yes | `--fs-xs`, `--muted` |

- Put the short id of the item in `data-annotate`, so that a note stays on the item.

| Do | Don't |
|---|---|
| `data-annotate="a1700"` | a `data-annotate` that changes on each redraw |

#### Ask card

An ask card asks Chris a question. It shows the question, the choices and the buttons that answer it.

**Use:** for each Ask that waits for Chris. **Not for:** a note with no answer; use a feed row.

| Helper | Reference |
|---|---|
| `askCard(i)` in `ui/views/cards.js` | `ui/views/now.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Kind | approve, decide or unstick | | sets the colour, `-bg` and `-ring` of the card (`--approve`, `--decide`, `--unstick`) |
| 2 | Box | The Ask | | `--surface`, border the ring of the kind, shadow `--lift`, radius `--r-card` |
| 3 | Head | A dot, the kind, the title | | `--fs-lg` on the `-bg` of the kind; kind `--fw-strong` in the colour of the kind |
| 4 | Question | The question, when the card is open | | `--fs-lg` `--fw-strong`; 80ch maximum |
| 5 | Choices | One button for each answer | | `--sp-8` apart; when open, a 200px column of buttons, then the text |
| 6 | Recommended | The mark on the recommended choice | yes | `--fs-xs` `--fw-strong`, the colour of the kind |
| 7 | Details | Technical details | yes | a closed fold |

- Make each choice with `actButton()`. Mark the recommended choice.
- When a choice needs a reason, use the reason box of the two-click confirm.
- Put the technical details last, in a closed fold.

| Do | Don't |
|---|---|
| the recommended choice marked | two choices marked |
| technical details in a closed fold at the end | logs in the question |

#### Lane

A lane is a column of item cards under a head with a count.

**Use:** for the Running, Queued and Done columns of the Status page. **Not for:** a list page; use a table.

| Helper | Reference |
|---|---|
| `renderLanes(s)` in `ui/views/now.js` | `ui/views/now.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Head | The state dot, the name of the lane and its count | | the card title and count; an 8px dot: Running `--run`, Done `--done`, Queued `--muted` |
| 2 | Cards | The item cards | | one column, `--sp-12` apart |
| 3 | Empty line | The line when the lane has no items | | `--fs-sm`, `--muted` |

- Put three lanes side by side in `.lanes`, `--sp-20` apart. In `.rail-main`, the lanes go to two columns when it is narrower than 760px, and to one under 480px (container queries). Elsewhere they stay at three.
- When a lane has a cap, its count is `<shown> of <cap>`.
- Write the empty line as one sentence: `Nothing is running.`

| Do | Don't |
|---|---|
| `Running` with a muted `3` | `Running (3)` |

#### Feed row

A feed row shows one event in a feed. The newest event is first.

**Use:** in the feed of the Status page. **Not for:** the events of one run; use the timeline.

| Helper | Reference |
|---|---|
| `eventRow(ev, titles)` in `ui/views/now.js`; the Herald's status rows use its `feedRow()` | `ui/views/now.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Time | The time of the event | | `--mono` `--fs-xs` tabular, `--muted`; 55px |
| 2 | Action | What happened, in lower case | | `--fw-mid`, the colour of its tone; 70px |
| 3 | Id | The item | | `--mono` tabular; 64px; one line |
| 4 | Body | The title, then what happened | | title `--ink`, one line; what `--muted` |
| 5 | Live row | The event in progress | yes | `--unstick-bg`, border `--unstick-ring`, radius `--r-card` |

- Format the time with `clock()`, else `when()`.

| Do | Don't |
|---|---|
| `14:05 landed a1700` | `2026-11-10T14:05:00Z Landed` |

#### Findings list

The findings list shows the numbered findings of a Monitor report.

**Use:** for a Monitor report. **Not for:** other lists; use a table or `moreFold()`.

| Helper | Reference |
|---|---|
| `findingsList(findings)` in `ui/views/now.js`, one `findingHtml()` `<li>` each in `<ol class="findings">` | `ui/views/gates.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Fold | The report | | a closed fold; the summary gives the day and the count |
| 2 | Finding | One finding | | `--ink-2`, line height 1.35; `--sp-4` apart |

- Keep the fold closed.

| Do | Don't |
|---|---|
| `findingsList(findings)` | a finding list built in the view |

### Labels

#### Badge

A badge shows a state. It has square corners.

**Use:** for a state or a priority. **Not for:** a label; use a chip.

| Helper | Reference |
|---|---|
| `badge(state)`, `priorityBadge(p)`, `tag(text, tone, title)` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Badge | The state | | `--fs-xs` `--fw-strong`; radius `--r-tag`; one line |
| 2 | Tone | The colour of the state | | run, done, need or stuck: the tone on its `-bg`; quiet: `--muted` on `--sunk`; parked: a `--muted` outline |

- For other short status text, use `tag()`.
- When you add a state, add it to the tone map of `tone()`. Do not add a class by hand.

| Do | Don't |
|---|---|
| `badge("failed")` | `tag("failed", "stuck")` |
| `badge("failed")` | a chip for a state |

#### Chip

A chip shows a label. It has round ends.

**Use:** for the labels of an item. **Not for:** a state; use a badge.

| Helper | Reference |
|---|---|
| `chips(labels)` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Chip | One label | | `--fs-xs`, `--ink-2` on `--sunk`; radius `--r-pill`; one line; 16ch maximum in a table |

- When there are no labels, `chips()` shows nothing. Do not write a placeholder.

| Do | Don't |
|---|---|
| `chips(["ui", "css"])` | a badge for a label |
| nothing for no labels | `–` for no labels |

### Actions

#### Button

A button starts an action on the server.

**Use:** for an action. **Not for:** a link to another page; use the link button.

| Helper | Reference |
|---|---|
| `actButton(label, data, { primary, cls })` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Button | A verb | | `--sans` `--fs-sm` `--fw-mid`, `--ink` on `--surface`, border `--rule`; `--ctl-h` high; radius `--r-ctl`; border `--ink-2` on hover |
| 2 | Primary | The main action | yes | `--surface` on `--ink` |
| 3 | Warn | An action that stops or drops work | yes | `--need` on `--need-bg`, border `--need` (Status page head only, Deviations) |

- Write the label as a short verb.
- Give `act`, `path` and `label` in `data`. Give `body` as a JSON string when the request has one, and `name` to keep the message across a refresh. `ui/router.js` sends the request. Do not use `diff` or `always` as `act`: the router handles them on their own.
- While the request runs, the router disables every button of the row. On success it removes the card and reloads the page. On failure it enables the buttons again and writes the form message.
- Use one `primary` button in a group, or none.
- Set `cls: "warn"` on an action that stops or drops work.
- For Land, Drop and Pause, add `confirm` (Two-click confirm).

| Do | Don't |
|---|---|
| `Retry`, `Land` | `Click to retry this job` |
| one primary button | two primary buttons side by side |

#### Link button

A link button goes to another page. It looks like a button.

**Use:** for navigation only: Issue, Next sub-issue, Trace. **Not for:** an action; use the button.

| Helper | Reference |
|---|---|
| `linkButton(label, href)` | `ui/views/kit.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Link | The name of the page | | the button style; no underline |

- Write the name of the page that the link opens.

| Do | Don't |
|---|---|
| `linkButton("Issue", "#/issues/1700")` | a `<button>` that sets `location` |

#### Link

A link goes to another page, or does a small action in place.

**Use:** for navigation in text, ids and rows. **Not for:** a link that must look like a button; use the link button.

| Helper | Reference |
|---|---|
| `idLink(id, href)`, `repoIdLink()`; `crumb()`; `tr.rowlink`; `button.link` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Prose link | A link in `.md` text | yes | the text colour; underlined |
| 2 | Id link | The short id of an item | yes | `--mono` `--fs-xs` `--fw-mid`, `--muted`; `--ink` and underlined on hover |
| 3 | Row link | A table row that goes to its item | yes | the whole row is the target; the `<a>` is in `td.wide` |
| 4 | Text button | A small action in place, such as Show more | yes | `--run`; underlined on hover |

- Make an id with `idLink()` or `repoIdLink()`, never with a plain `<a>`.
- Make a row that goes to a page with `tr.rowlink`, and put its one link in `td.wide`.
- Use `button.link` for an action that stays on the page. Use `<a>` only to go to another address.

| Do | Don't |
|---|---|
| `idLink("a1700", "#/issues/1700")` | `<a href="#/issues/1700">a1700</a>` |
| `<button class="link">Show more</button>` | `<a href="#">Show more</a>` |

#### Command

A command box shows a command for the reader to run. A click copies it.

**Use:** for a command that the reader runs in a shell. **Not for:** code in prose; use Markdown and code.

| Helper | Reference |
|---|---|
| `cmd(text, { primary, hint })` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The command | | `--mono` `--fs-sm` `--fw-mid`, `--ink` on `--sunk`, border `--rule`, radius `--r-ctl`; wraps |
| 2 | Hint | A note on the command | yes | `--sans` `--fs-xs` |
| 3 | Copy | The word `Copy` | | `--sans` `--fs-xs`; a rule before it |
| 4 | Primary | The command that the page asks for | yes | `--surface` on `--ink` |

- Use one `primary` command on a page, or none.

| Do | Don't |
|---|---|
| `cmd("aleph issue list aleph")` | a `<pre>` that the reader must select to copy |

#### Row actions

Row actions are the buttons of one row or one card.

**Use:** under the text of a row or a card. **Not for:** the actions of a page; put them in the page head.

| Helper | Reference |
|---|---|
| `.actions` after the text of the row | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Row | The buttons and the form message | | `--sp-8` apart, `--sp-14` above; wraps |

- Do not put a button in a table cell.
- Show the result with `say()`.

| Do | Don't |
|---|---|
| actions under the text of a row | a button in a table cell |

#### Form message

A form message shows the result of an action, next to its button.

**Use:** after an action fails, and only then. A success shows by the reload. **Not for:** a page that did not load; use `error()`.

| Helper | Reference |
|---|---|
| the router, for `actButton()`; `say(el, text)` for a handler the view wires itself | `ui/router.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Message | What failed and why, in one line | | `--fs-sm`, `--stuck` |

- For an `actButton()` button, the router writes `<act> failed: <reason>`. Do not write it yourself.
- In a handler of your own, call `say()` with what failed, then why. `say()` writes into the `.act-msg` of the button's parent, else adds one after the button.
- Do not use `say()` for a success.

| Do | Don't |
|---|---|
| `land failed: the branch has conflicts` | `say(btn, "Saved.")` |

#### Two-click confirm

The two-click confirm asks for a second click before an action that is hard to undo.

**Use:** for Land, Drop and Pause, and for an answer that needs a reason. **Not for:** an action that is easy to undo.

| Helper | Reference |
|---|---|
| `confirm` in the `data` of `actButton()`; `ui/router.js` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Asking button | `<label> <name>? Click again` | | `--need` on `--need-bg`, border `--need` |
| 2 | Reason box | The reason | yes | the full width of the row |

- Give `label` in `data` too, and `name` when the action has an object. The first click changes the text to `<label> <name>? Click again`, or `<label>? Click again` with no `name`, for 5 seconds.
- For an answer that needs a reason, put the button in a `.choice` with an `input.reason`. The first click opens the box, and the label changes to `Confirm`.

| Do | Don't |
|---|---|
| `actButton("Drop", { act: "drop", path, name: "a1700", confirm: "1", label: "Drop" })` | `confirm()` from the browser |

#### Disclosure

A disclosure is a fold. It hides detail until the reader opens it.

**Use:** for detail that most readers do not need. **Not for:** a section of a detail page; use `detailPanel()`.

| Helper | Reference |
|---|---|
| `fold(summary, body, { open, keep, cls, head })`; `moreFold(items, row)`; `clamp(html)`; `wireFolds()`, `restoreFolds()` | `ui/views/kit.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Fold | The detail | | rule `--rule-2` above; `--sp-10` above |
| 2 | Summary | What the fold holds | | `--fs-sm`, `--ink-2` |
| 3 | Marker | `+` when closed, `−` when open | | `--mono`, `--muted` |

- Keep the fold closed, unless the reader came to the page for its content.
- The router keeps open folds across a refresh. To keep a fold's state across page loads too, pass `keep`.
- For a long list, use `moreFold()`: 10 items, then a fold.
- For long text, use `clamp()`: 3 lines, then Show more.
- At the end of a card, put technical details in `fold("Technical details", body, { cls: "more" })`.

| Do | Don't |
|---|---|
| `<summary>12 more</summary>` | `<summary>More</summary>` |
| a closed fold | an open fold of logs |

### Text

#### Markdown and code

Markdown shows prose. A code block shows code or output.

**Use:** for prose from a file or a note. **Not for:** a command that the reader runs; use the command.

| Helper | Reference |
|---|---|
| `md(src)` into `.md`; `codeText(t)` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Heading | A heading of the prose | yes | `--sans` `--fs-lg` `--fw-strong` |
| 2 | Inline code | A name or a value | yes | `--mono` `--fs-xs` |
| 3 | Code block | Code or output | yes | `--mono` `--fs-xs` on `--sunk`, radius `--r-tag`; long lines wrap |
| 4 | Table | A table in the prose | yes | `--fs-xs`, border `--rule` |

- Keep prose at 80 characters wide or less. `.md` sets no width: put it in a `panel()`, or give its box `max-width: 80ch`.
- For code in a line of text, use `codeText()`.

| Do | Don't |
|---|---|
| `md(spec)` | prose set as HTML by the view |
| `codeText("run `bun test`")` | backticks shown as text |

#### Diff

A diff shows the lines that a change adds and deletes.

**Use:** for the change of a job. **Not for:** other code; use a code block.

| Helper | Reference |
|---|---|
| `diffHtml(text)` into `.diff-panel` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Panel | The diff | | `--mono` `--fs-xs` on `--sunk`, border `--rule`, radius `--r-ctl`; 480px high maximum, then scrolls |
| 2 | Added line | A line that the change adds | | `--add` |
| 3 | Deleted line | A line that the change deletes | | `--del` |
| 4 | Hunk | The place of the change | | `--muted` |

- Do not colour a diff line by hand. `diffHtml()` reads the first character of each line.

| Do | Don't |
|---|---|
| `diffHtml(patch)` | `--done` and `--stuck` on diff lines |

### Controls

#### Filter bar

A filter bar is a row of filters over a table.

**Use:** for the filters of one table. **Not for:** the filters of the whole page; put them in the page head.

| Helper | Reference |
|---|---|
| `filterBar(groups)`; `searchBox(ui, value, placeholder)` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Label | The name of the filter | | `--fs-xs`, `--muted` |
| 2 | Segmented control | A fixed set of options | | `--sans` `--fs-sm`, `--muted`, border `--rule`, radius `--r-ctl`; `--ctl-h` high; scrolls inside itself |
| 3 | Pressed option | The option in use | | `--fw-strong`, `--ink` on `--rule-2` |
| 4 | Select | Options from the data | yes | `--ctl-h` high |
| 5 | Search | Text to search for, from `searchBox()` | yes | on `--sunk`; `--ctl-h` high |

- For options from the data, set `data: true` to get a select.
- Make the first option `{ value: "", label: "All" }`. An empty value keeps the filter out of the address.
- When a filter changes the data, use `goQuery()`. When it changes only what shows, use `setQuery()` and draw the table again, or let `wireTable()` do both.
- Put `searchBox()` above the filter bar, outside the part that redraws, so it keeps the focus. Give its `ui` key to `wireTable({ search })`.

| Do | Don't |
|---|---|
| `{ value: "", label: "All" }` first | `"All"` as a value, which puts `?state=All` in the address |

#### Pager

A pager shows the rows after the first 50.

**Use:** under a table of more than 50 rows. **Not for:** a short list; use `moreFold()`.

| Helper | Reference |
|---|---|
| `pager(shown, total)`; `limitOf()`; `pagedTable()` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Button | `Show 50 more` | | the button |
| 2 | Count | `50 of 345` | | `--num` `--fs-xs` `--fw-mid` tabular, `--muted` |

- For a table that `wireTable()` sorts, filters or searches, use `pager()` with `limitOf()`. The limit stays in the address.
- For a table that does not change, use `pagedTable()`. It shows the rows in place.
- Do not use both under one root.
- The button names the rows that are left, up to 50: `Show 12 more`.

| Do | Don't |
|---|---|
| `Show 50 more` with `50 of 345` | page numbers |

#### Empty state

An empty state shows that there is nothing, that data loads, or that the data did not load.

**Use:** in place of a table, a chart or a list that has nothing to show. **Not for:** the result of an action; use the form message.

| Helper | Reference |
|---|---|
| `empty(line, hint)`, `loadingLine(what)`, `error(line, hint)`; `loading(title)` in the router only | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Line | What is not there, in one sentence | | `--ink`; an error `--stuck` |
| 2 | Hint | What to do | yes | `--fs-sm`, `--muted` |
| 3 | Loading | `Loading <what>…` | | `--muted` |

- The router shows `loading()` while a page loads, and `error()` when the first load fails. A view does not call them for its own data.
- For a section that loads after the page, use `loadingLine(what)`: `Loading the diff…`.
- Use `error(line, hint)` for a second fetch inside a card that failed. With no hint, it tells the reader to check aleph-ui and reload.
- The `empty()` hint is HTML: escape data with `esc()`. The `error()` hint is text.

| Do | Don't |
|---|---|
| `empty("No job matches.", "Widen the window or clear a filter.")` | `<p class="quiet">No data</p>` |
| `error("The agents did not load.")` | `Error: fetch failed` |

## States

| State | Rule |
|---|---|
| Focus | a `2px solid var(--focus)` ring, 2px outside the control, on `:focus-visible` |
| Hover | a border goes to `--ink-2`, or text to `--ink`; rows and nav items go to `--sunk`; a metric card that is a link or a selector takes a `--run` border |
| Pressed: segmented option | `aria-pressed="true"`; `--ink` on `--rule-2`, `--fw-strong` |
| Pressed: metric card | `aria-pressed="true"`; `--raised` with a `--run` border |
| Pressed: bar row | `aria-pressed="true"`; `--sunk`, label `--fw-strong` |
| Selected | `aria-selected="true"` on a row that shows its detail beside it; three forms today (Deviations) |
| Disabled | opacity `--dim` and a wait cursor, while a request runs |
| Active | a command box moves 1px down |

| Do | Don't |
|---|---|
| `outline-offset: -2px` inside a container (`.seg button:focus-visible`) | a ring that the container clips |
| `:focus-visible` | `:focus`, which also rings on a click |

## Layout

| Part | Rule |
|---|---|
| Sidebar | `#nav`, 208px open, 48px when collapsed (`.shell.collapsed`); at 720px and narrower, a sticky bar at the top: one row, the links scroll sideways, and the current link scrolls into view |
| Page | `.page`: 2400px max, `28px 24px 64px` padding, `20px 16px 48px` at 720px |
| Browser | `::selection` is `--focus` at 35%; scrollbars are thin, `--rule` on transparent |
| Grid | `.tiles` holds metric cards; `.lanes` holds lanes; `.trio` holds chart panels; `.browse` is a list with its detail beside it, one column under 1100px |

- **List page:** page head, metric cards, then cards.
- **Detail page:** crumb, page head, status row, KPI strip, then detail panels.

## Views

A page is a view module in `ui/views/`. The router reads its `view` object (the comment at the top of `ui/router.js`).

| Field | Holds |
|---|---|
| `path`, `title` | the route and the page title |
| `group`, `order`, `icon`, `nav` | the place in the sidebar; `icon` is a Font Awesome name; `nav: false` leaves the page out |
| `api` | the URL of the data |
| `render(data, params, query)` | the HTML of one `<div class="page">` |
| `mount(root, data, query)` | the wiring, after each render |
| `refresh`, `live` | seconds between reloads; `live: true` also redraws on a pushed change |

- `mount()` runs again after every redraw, on the same `#view` root. Wire with `root.onclick =` and the other `on*` properties. Do not call `addEventListener` in `mount()`: each redraw adds one more handler.
- A handler that must stay across routes goes on `document`, once, when the module loads. It checks its target.
- Do not catch the failure of the view's own `api`: the router shows it.

## Accessibility

- Contrast: see Colour, Contrast.
- Bar tones rely on colour alone. A diff line also keeps its `+` or `-`.
- A row that is not a button but takes a click has `tabindex="0"` and opens on Enter and Space.
- Hide a label that is only for screen readers with `.sr`.
- Scroll smoothly only when `prefers-reduced-motion` is not `reduce`.
- `aria-sort` on sort headers, `aria-pressed` on selector cards and segmented options.

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
| Sections built from `sectionHead()` with no card box: they hold cards, and a card does not sit in a card | Waiting for You in `ui/views/gates.js`; Memory Health in `ui/views/memory.js`; the Status Alerts and lanes in `ui/views/now.js` | allowed |
| Two box systems: the card pads with `--gap-in`, the detail panel with `--sp-14` and `--sp-18` | `ui/app.css` | review on `#/kit` |
| Empty, loading and error lines written inline | `ui/views/now.js`, `ui/views/gates.js`, `ui/views/memory.js`, `ui/views/session.js`, `ui/views/ideas.js` | follow-up |
| The feed row's tones (`alert`, `warning`, `fine`) are its own, not `tone()` | `eventRow()` in `ui/views/now.js` | follow-up |
| Light `--series-3` to `--series-5` are under 3:1 on `--surface` (2.82, 2.17, 2.69); the legend and the tooltip carry the key | `ui/app.css` | aleph-1806 (pending) |
| Dark `--chart-6` and `--chart-7` are outside the lightness band, and `--chart-7` reads grey; light `--chart-6` and `--chart-7` are 6.5 apart under deuteranopia | `ui/app.css` | aleph-1807 (pending) |
| Charts outside the chart panel: the Agent Time bar, the session waterfall | `ui/views/speed.js`, `ui/views/session.js` | allowed |
| A table written by hand | `ui/views/memory.js` | follow-up |
| An item card's meta row clips its badges to one letter in a narrow lane | `ui/app.css` | review on `#/kit` |
| Timeline axis labels overlap when two ticks are close | `renderTimeline()` in `ui/timeline.js` | review on `#/kit` |
| The Ideas page head has no Project select | `ui/views/ideas.js` | follow-up |
| Two `act()` wrappers with different signatures; `shell()` has no callers | `ui/views/cards.js`, `ui/views/memory.js` | follow-up |
| A metric card's second value hides at phone width, so `v` shows with a `q` that names two values | `ui/app.css` | review on `#/kit` |
| A metric key on two lines pushes its value below the values of the cards beside it | `ui/app.css` | review on `#/kit` |
| Not every text that can end in an ellipsis has its full text in `title`; not audited | views | follow-up |
| A selected row is drawn three ways: `.mrow` (`--raised`, `--run` border), `tr.nrow` (inset `--run` bar), the nav (inset `--ink` bar) | `ui/app.css` | follow-up |
| The outcome bar shows `empty()` with no card | `bar()` in `ui/views/speed.js` | follow-up |
| `now.js` scrolls smoothly without the reduced-motion check | `ui/views/now.js` | follow-up |

## Appendix

### What could not be determined

| Gap | Note |
|---|---|
| Earlier decisions | Absolute time is `10/28 14:05`, as aleph-199 decided. No other decision outranks the code. |
| Browser checks | Responsive behaviour is read from the media queries, not seen. |
| Colour token uses | The inventory counts colour definitions, not uses. |
| Contrast | Only the listed pairs. `--muted` on `--rule-2` (4.41, 5.04) has no traced use. |
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
| colour | literal | 6 |
| colour | token-def | 98 |
| effect | literal | 36 |
| effect | token-use | 10 |
| format | helper-bypass | 42 |
| size | literal | 131 |
| size | token-def | 18 |
| size | token-use | 563 |
| type | literal | 34 |
| type | token-def | 42 |
| type | token-use | 52 |
