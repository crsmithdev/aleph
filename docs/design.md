# UI design language

The design language of `ui/`, read from the code by the design-language skill (`skills/design-language/SKILL.md`). It goes from principles to foundations, content and components, then to states and layout. A value that the rules do not allow is a deviation, listed at the end.

The Kit page, `#/kit` (`ui/views/kit.js`), draws each token and component with its own helper from fixture data, in light and dark, and shows each component's section beside its specimen. A new component gets a section here and a specimen there.

## Principles

1. **One token set, two themes.** Colours are custom properties on `:root` in `ui/app.css`, set again for dark by `@media (prefers-color-scheme: dark)` and by `:root[data-theme="dark"]`. A view that uses only tokens gets dark mode free. Light is lavender; dark is Palenight.
2. **Shared helpers build the parts.** Views call `ui/lib.js`; the CSS is in `ui/app.css`. A fix in one helper fixes every page.
3. **Meaning is a tone.** `run`, `done`, `need`, `stuck`, `quiet` or `parked`, from `tone()` in `ui/lib.js`. One state has one colour on a badge, a series and a card, so a reader learns it once. A tone comes only from `tone(state)`. A name that is not a state, such as an actor, is a `chip()`. A chart series for a state takes the colour of `tone(state)`.
4. **Numbers are tabular.** Tabular figures, at the right, so digits line up in a column. The class is `.num` or `.tnum`; no other rule sets `font-variant-numeric`.
5. **Plain text states.** An empty state is `No data` from `empty()`, the same on every page. A missing value is `–` from `miss(reason)`, with the reason as its title (Content, Values), never `N/A` or `0`. A zero stays `0`.
6. **Be terse.** A note, a qualifier or a caption is one or two words. Do not fill a space because it is there. Do not explain what the title, the axis or a tooltip already says. A definition goes in a `title` tooltip or nowhere.

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
| `--sel` | `--focus` at 35% | the same | the `::selection` fill |

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
| `--fs-metric-min` | 16px | the smallest metric value, on a narrow card |

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

| Token | Value | Role | Where |
|---|---|---|---|
| `--ls-display` | `-0.02em` | tracking of display and brand type | `.mark`, `.shead .say`, `.shead .asof`, `.sh h2`, `.ph h1`, `.tile b` |
| `--ls-caps` | `.06em` | tracking of uppercase keys | `#nav li.head`, `.tile .k`, `.herald-sticky-head`, `.ins h4` |

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
| `--dot-s` | 6px, a dot |
| `--dot-m` | 8px, a dot; the ask dot |
| `--dot-l` | 12px, a dot |
| `--measure` | 76ch, the width of prose |

- A dot is `--dot-s`, `--dot-m` or `--dot-l` wide and high. Its circle is `--r-pill`, never `50%`.
- All prose is at most `--measure` wide. Do not write `80ch`.
- A `position: sticky` `top` is `--sp-8` or `--sp-16`.

| Do | Don't |
|---|---|
| `margin: calc(-1 * var(--sp-2))` | `margin: -2px` |
| `width: 320px` | `width: var(--sp-28)` for a width |
| `border-radius: var(--r-pill)` | `border-radius: 50%` |
| `max-width: var(--measure)` | `max-width: 80ch` |

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

A current item (the sidebar link, the contents entry) has an inset 2px `--ink` bar at the left. A selected row (`aria-selected="true"`: `.mrow`, `tr.nrow`) is `--sunk` with an inset 2px `--run` bar at the left. A parked item has a `box-shadow: inset` ring. A pipeline stage on the Status page is a 5px inset ring; its colour is the stage's failed share.

#### Breakpoints and motion

| Rule | Value |
|---|---|
| Breakpoints | 720px and 1100px, literal, as `@media` takes no tokens |
| Container widths | three `@container` widths, literal: 560px (`pipeline`), 480px (`rail-main`) and 420px (`.tile`, `.lane-card`, `.issue-row`) |
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

- A missing value is always `–`, from the format helper. When there is no helper, write `miss(reason)`: the `–` carries the reason as its title. Zero stays `0`.
- Show every integer through `count()`.
- Write a count with its noun through `plural(n, one, many)`: `1 run`, `2 runs`. Give `many` when the plural is not `one` + `s`. A view has no copy of its own.
- Show code in a line of text only through `codeText()`.
- Make a line of facts about an item with `meta(parts)`: a muted `--fs-xs` line, its parts split by a `·` that the CSS draws. An empty part is left out.
- Make a commit with `shaLink(hash, url)`: the short hash, an `idLink()` when there is a URL, a `span.idp` when there is none. `idLink(id, href)` also draws a `span.idp` when `href` is missing.
- Make a side note with `note(text)`: `--fs-sm`, `--muted`, no margin. It replaces `p.quiet`, `p.quiet.q` and `p.hint` used as a side note.
- Make the head of a part inside a card or a panel with `subHead(text)`: small capitals, `--muted`, sentence case. It is the only heading inside a card or a panel.

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
| Missing value | – | `miss(reason)` | the reason is its title |
| Commit | 3f9a1c2 | `shaLink(hash, url)` | none |
| Meta line | 11/10 · 4m 05s | `meta(parts)` | an empty part is left out |
| Note | a side note | `note(text)` | none |
| Sub-head | Recent runs | `subHead(text)` | none |

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
- Write an empty state with `empty()`: `No data`, with no hint. Give it another line only for a state that is not missing data, such as `Langfuse off` or `Select a row`, in at most three words.
- Write a note, a qualifier or a caption in one or two words: `over pace`, `p50 weekly`. Put more in a `title` tooltip.
- Write an error line as `Could not load X.` and a hint. Put the upstream message in a Technical details fold (`error()` with `detail`).
- Offline, the page says "The server is unreachable. Showing the last data." (`ui/index.html`).

| Do | Don't |
|---|---|
| `Jobs per Item`, `Linked from` | `Jobs Per Item`, `jobs per item`, `Linked From` |
| `Running` with a muted `3` after it | `Running (3)` |
| `Next 50` | `Click here to load more results` |
| `running`, `landed`, `critical` | `Running`, `LANDED` |
| `empty()`, which shows `No data` | `No agent job on an issue ended in the last hour.` with the hint `Widen the window or clear the project.` |
| `over pace`, with the off-machine share in the bar's tooltip | `2% off this machine, under pace, live` |
| `Could not load the agents.` with the hint `Check that aleph-ui is running, then reload.` and the upstream message in a Technical details fold | `Error: fetch failed` |
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
| `card(title, body, { count, aside, id, lede })` | `ui/views/factory-agents.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Box | The section | | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card`, padding `--gap-in` |
| 2 | Title | What the section holds | | `--sans` `--fs-lg` `--fw-strong`, `--ink` |
| 3 | Count | The number of items | yes | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| 4 | Aside | Controls, or one note | yes | `--fs-xs`, `--muted`; at the right |
| 5 | Lede | One sentence that sums up the card | yes | `--fs-sm`, `--muted`; under the head |
| 6 | Body | The content | | `--fs-sm`, `--ink-2` |

- Do not put a card in a card.
- Give `lede` as one sentence that sums up the card. A failure goes to `notice()`, not to the lede.
- A heading inside a card is `subHead()`.
- Give an `id` when a link goes to the section.

| Do | Don't |
|---|---|
| `card("Recent Jobs", dataTable(…), { count: 12 })` | a section head with no box (`sectionHead()` alone) |
| `card("Recent Jobs", empty())` | no card when the section is empty |

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

- For prose (Spec, Result, Description), use `panel()`. Wrap the prose in `<div class="md">`: that wrapper gives the padding and the `--measure` (76ch) width.
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
- A detail page opens with `statusRow()` and a KPI strip. The issue that builds a page chooses its KPIs with `aleph:metrics`.

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

#### Pair

A pair puts two cards side by side.

**Use:** for two cards that a reader compares or reads together. **Not for:** three charts; use `.trio`. Metric cards go in `.tiles`.

| Helper | Reference |
|---|---|
| `.pair` around two `card()` calls | `ui/views/efficiency.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Pair | Two cards | | a grid of `auto-fit` columns, each at least 320px (or the width, if less), `--gap-in` apart |

- Put exactly two cards in a pair. The columns stack when the width is under two cards.
- Give each card its own title and count. Do not share a title.
- Do not set a width on a card in a pair.

| Do | Don't |
|---|---|
| `<div class="pair">${card(a)}${card(b)}</div>` | two cards with a width of 50% each |

#### List and group

A list stacks rows or cards. A group is a named part of a page or a card.

**Use:** a list for the rows or cards of one section; a group for a part that a link goes to. **Not for:** items with the same columns; use a table. **Not for:** two cards side by side; use the pair.

| Helper | Reference |
|---|---|
| `list(html)`; `group(id, html)` | `ui/views/kit.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | List | The rows or cards | | `.list`: one column, `--sp-12` apart |
| 2 | Group | A part, with an `id` | | `.grp`; `--sp-16` between groups |

- Give each group an `id` that is unique on the page, so that a link can go to it.
- Do not put a group in a group.

| Do | Don't |
|---|---|
| `list(rows.map(card).join(""))` | a `<div>` with a grid written by hand |

#### Contents

The contents are a list of links to the sections of a long page, in a rail that stays in view while the page scrolls.

**Use:** on a page of more than five sections, or one that scrolls more than about three screens. **Not for:** two to five panes that a reader needs one at a time; use tabs. **Not for:** links to other pages; use the sidebar.

| Helper | Reference |
|---|---|
| `toc(items, body)`; `wireToc(root)` | `ui/views/gates.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Rail | The word "Contents" and the list, in a `nav` | | 220px at the right of the body, `--sp-28` apart; sticky `--sp-16` from the top; it ends above the kit dock and scrolls when taller |
| 2 | Entry | An `<a href="#id">` to one section | | `--fs-sm`, `--muted`, on a `--rule` hairline at the left; a `sub` entry is indented `--sp-24` |
| 3 | Current entry | The entry of the section at the top of the view | | `aria-current="location"`; `--ink`, `--fw-strong`, a 2px `--ink` bar at the left, as the sidebar's current link |

- `items` is `[[id, label, sub]]`. Each `id` is the `id` of a section in `body`, such as the `id` of a `card()`. A `sub` entry sits under the entry before it.
- Label each entry with the title of its section, in the same words.
- List the sections in page order. Leave out a section with no heading, such as the metric cards at the top.
- A link scrolls the page in place: the router handles an `#id` link and leaves the address as it is.
- `wireToc()` marks the current entry: the first section that crosses the band from 10% to 40% down the view. It scrolls the rail, not the page, to keep that entry in view. At the end of the page the last entry is current. When no section is in the band and the page is not at its end, no entry is current. A clicked entry stays current until the next scroll by hand (wheel, touch or a key) or a click outside the rail.
- Under 1100px the contents are a fold above the body, closed by `wireToc()`. They do not stay in view.

| Do | Don't |
|---|---|
| `toc([["gates-log", "Log"]], body)` and `card("Log", …, { id: "gates-log" })` | a list of links written by hand at the top of the page |
| `<a href="#gates-log">` | `<a href="#/automation#gates-log">`, which the router reads as a route |

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
| 2 | Key `k` | The measure | | `--sans` `--fs-xs` `--fw-strong`, capitals, `--muted`; breaks only between words, on up to two lines; the trend stays at the right and the row keeps two lines of height |
| 3 | Trend | The change from the baseline | yes | `--fs-sm` `--fw-strong`, a pill (radius `--r-pill`); `--good` on `--done-bg` when good, `--need` on `--need-bg` when bad, else `--muted` on `--sunk` |
| 4 | Value `v` | The number | | `--metric` `--fw-strong`, `-0.025em`, from `--fs-metric-min` up to `--fs-metric`, tabular, `--ink`; one line |
| 5 | Second value `v2` | A second number after ` / `, such as the cap | yes | `--metric` at .62em, `--muted` |
| 6 | Bar `extra` | A meter | yes | the meter |
| 7 | Qualifier `q` or `note` | The names of the two values, or a note | | `--fs-xs`; one line; first name `--ink`, second `--muted` |

- Write the key in two or three words. The CSS sets it in capitals.
- When the value is unknown, write `–`. Give no note to explain it.
- With `v2`, give `q` as `[first, second]`: one name for each value, in lower case, in one word or a few words.
- With no `v2`, you can give a `note` in place of `q`, in one or two words. Put a definition in a tooltip, not in the note.
- Make the trend only with `cardTrend(value, base, prev, { kind, lowerIsGood, format, basis })`. Set `kind` to `points` for a share, and to `relative` for a time or a count. Set `lowerIsGood` to `null` when no direction is good. With no baseline, `cardTrend()` shows nothing.
- Put only a `meter()` or a column of status lights in `extra`.
- For a link to another page, give `href`. For a card that selects the view under it, give `key`, set `on` on the selected card, and connect the cards with `onTile()`.

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | `v2` with no `q` |
| `q: ["in use", "cap"]` | `q: ["In Use", "Maximum Capacity"]` |
| `k: "Worker slots"` | `k: "Worker slots in use right now"` |
| `v: "–"` | `v: "0"` for an unknown value |
| `note: "over pace"` | `note: "2% off this machine, under pace, live"` |

#### Table

A table shows items that have the same columns.

**Use:** for a list of items. **Not for:** the properties of one item; use a fact list.

| Helper | Reference |
|---|---|
| `dataTable(head, rows, { fit })`; `heads(labels, num)`, `sortHead()`, `wireTable()`; `pagedTable()`; `badCount(n)` | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Header | The name of each column | | `--sans` `--fs-xs` `--fw-strong`, `--muted`; the sorted column `--ink` |
| 2 | Cell | One value | | `--fs-sm`, `--ink`; padding `--sp-6` `--sp-12` `--sp-6` 0; rule `--rule-2` below; one line |
| 3 | Title cell `td.wide` | The title of the item | | takes the spare width, 16ch minimum; ends in an ellipsis |
| 4 | Number cell `td.num` | A number | | `--num` `--fw-mid` tabular; at the right |
| 5 | Sort arrow | `▲` or `▼` | yes | `--fs-xs` |
| 6 | Row | One item | | `--sunk` on hover |
| 7 | Row action | One small button in the last column, `td.acts` | yes | right-aligned, one line |

- Put the columns in this order: id or name, title, state, priority, project, labels, numbers, then time.
- In an event log, put the time first. An event log is a table where each row is an event, read in time order.
- Put each number at the right of the row. Align a number to the right.
- Name the time column for the time it shows. Format it with `when()`.
- Make an id with `idLink()` or `repoIdLink()`, a state with `badge()`, and labels with `chips()`.
- Put the title in `td.wide`. Do not let other cells wrap.
- Put each number in `td.num`. For `heads()`, list the column's label in `num`. For `sortHead()`, pass `{ num: true }`.
- Make a count of bad things, such as errors or failures, with `badCount()`. It turns `--stuck` above 0.
- Put the time in `td.time`. It aligns to the right. For `heads()`, list its label in `num`. For `sortHead()`, pass
  `{ num: true }`. A time that comes first goes in `td.time.lead`, which aligns to the left.
- When a row goes to a page, make it `tr.rowlink` and put the link in `td.wide`.
- To sort, use `sortHead()` and `wireTable()`. Keep the sort in the address as `sort` and `dir`.
- When there are more than 50 rows, use `pagedTable()`, or `pager()` with `pageOf()` and `pageRows()`.
- For a short table of names and numbers, set `fit: true`.
- Make a row with `row(cells)` and a cell of text with `cell(v, { num, wide, title })` (Row and cell).
- A row action goes in a last `td.acts` column, as a small button (Row actions). A data cell never holds a button.
- On a phone, the table scrolls sideways in `.tscroll`.

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed` | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `td.num` | numbers at the left |

#### Row and cell

A row and a cell build the body of a `dataTable()`.

**Use:** for each row of a table of text and numbers. **Not for:** a cell with markup, such as a badge or a link; write its `<td>` and pass it to `row()`.

| Helper | Reference |
|---|---|
| `row(cells)`; `cell(v, { num, wide, title })` | `ui/views/kit.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Row | The cells of one item | | a `<tr>` |
| 2 | Cell | One text value, escaped | | a `<td>`; `num` adds `td.num`, `wide` adds `td.wide` |
| 3 | Title | The full text of a cell that can end in an ellipsis | | the `title` of the cell |

- `cell()` escapes `v`. Give it text, not HTML.
- A `wide` cell gets its text as its `title`. Give `title` to set another.
- Show a missing value with `miss(reason)` in a `<td>` of your own, not with an empty `cell()`.

| Do | Don't |
|---|---|
| `row([cell(id), cell(title, { wide: true }), cell(count(n), { num: true })])` | a `<tr>` string written by hand for text cells |

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
- A key in `by` with no `color` takes the next of `series-1` to `series-5`, `chart-6`, `chart-7`, by its place among the keys with a value. For a state, set `color` to the colour of `tone(state)`: `run`, `done`, `need` or `stuck`. Two states can share a colour, such as Failed and Stuck, which are both `stuck` in the Agents outcome chart; the legend tells them apart. Other allowed values: `hot`, `muted`, `series-1` to `series-5`, `chart-6`, `chart-7`. `quiet` and `parked` are not chart colours.
- Keep the colour of a key the same in all windows. If a key can have no value in a window, set `color` on each key, because the keys after it move up one colour.
- Show at most seven keys. Fold the rest into one key, `Other`.
- Show a legend. When the frame has one key and the title names it, set `legend: false`.
- When there is no data, the panel shows `empty()`. A frame has no empty line, hint or note of its own.
- A linked row is also a link in a list under the chart, for the keyboard. The list shows when a link has focus.
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
- A bar with no link takes focus. Each bar names its state in its text, not only in `title`.
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
| 4 | Question | The question, when the card is open | | `--fs-lg` `--fw-strong`; `--measure` maximum |
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

- Put Running and Queued side by side in `.lanes-top`, `--sp-12` apart, and Done under them, `--sp-16` below. The top row goes to one column when `.rail-main` is narrower than 480px (container query).
- When a lane has a cap, its count is `<shown> of <cap>`.
- The empty line is `empty()`.

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
- When you add a state, add it to the tone map of `tone()`. Do not add a class by hand. A tone comes only from `tone(state)`.

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
- A name that is not a state, such as an actor, is a `chip()`, not a badge.

| Do | Don't |
|---|---|
| `chips(["ui", "css"])` | a badge for a label |
| nothing for no labels | `–` for no labels |

#### Status light

A status light shows whether one thing is up: a dot and a word.

**Use:** for the state of a service or a backend, inside a metric card or a row. **Not for:** the state of a job or an issue; use a badge. **Not for:** a log row; use a feed row.

| Helper | Reference |
|---|---|
| `statusLight(state, label)` | `ui/views/factory-agents.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Dot | The state: `fine` is `--done`, `alert` is `--stuck`, anything else is unknown and `--muted` | | 6px round |
| 2 | Label | The name and the state in words: `Local server: up` | | the text of the parent |

- Give the state in words too. A colour alone is not enough.
- When the state is not known, pass `unknown` and write `–` in the label: `OpenRouter: –`. Do not show it as `down`.
- Put several lights in `.lights`, one under the other.

| Do | Don't |
|---|---|
| `statusLight("alert", "OpenRouter: down")` | `<span class="event-dot alert">` written by hand |
| `statusLight("unknown", "Monitor: –")` | a green dot for a state that nobody read |

### Actions

#### Button

A button starts an action on the server.

**Use:** for an action. **Not for:** a link to another page; use the link button.

| Helper | Reference |
|---|---|
| `actButton(label, data, { primary, kind, cls })` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Button | A verb | | `--sans` `--fs-sm` `--fw-mid`, `--ink` on `--surface`, border `--rule`; `--ctl-h` high; radius `--r-ctl`; border `--ink-2` on hover |
| 2 | Primary | The main action | yes | `--surface` on `--ink` |
| 3 | Warn | An action that stops or drops work | yes | `--need` on `--need-bg`, border `--need` |
| 4 | Danger | An action that cannot be undone | yes | `--stuck` text |
| 5 | Small | An action in a row | yes | padding `--sp-6`, `--fs-2xs` |
| 6 | Always | An action that a card marks as always allowed | yes | border and text in the colour `--k` of the card, else `--ink-2` |

- Write the label as a short verb.
- Give `act`, `path` and `label` in `data`. Give `body` as a JSON string when the request has one, and `name` to keep the message across a refresh. `ui/router.js` sends the request. Do not use `diff` or `always` as `act`: the router handles them on their own.
- While the request runs, the router disables every button of the row. On success it removes the card and reloads the page. On failure it enables the buttons again and writes the form message.
- Use one `primary` button in a group, or none.
- Set `kind` to `danger`, `small` or `always`. Each has its own style.
- Set `cls: "warn"` on an action that stops or drops work.
- For Land, Drop and Pause, add `confirm` (Two-click confirm).

| Do | Don't |
|---|---|
| `Retry`, `Land` | `Click to retry this job` |
| one primary button | two primary buttons side by side |

#### Link button

A link button goes to another page. It looks like a button.

**Use:** for navigation only: Issue, Next sub-issue, Trace. A link to another page or tool in a head or an aside is a link button. **Not for:** an action; use the button.

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

- Make an id with `idLink()` or `repoIdLink()`, never with a plain `<a>`. With no `href`, `idLink()` draws a `span.idp`.
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
| `.actions` after the text of the row; `td.acts` in a table | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Row | The buttons and the form message | | `--sp-8` apart, `--sp-14` above; wraps |

- In a table, a row action sits in a last `td.acts` column, as a small button (`kind: "small"`). A data cell never holds a button.
- A setting that has a Save button goes in a settings list.
- Show the result with `say()`.

| Do | Don't |
|---|---|
| actions under the text of a row; a small button in `td.acts` | a button in a data cell |

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
| `confirm` in the `data` of `actButton()`; `ui/router.js`. For a handler of your own, `arm(btn, text)` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Asking button | `<label> <name>? Click again` | | `--need` on `--need-bg`, border `--need` |
| 2 | Reason box | The reason | yes | the full width of the row |

- Give `label` in `data` too, and `name` when the action has an object. The first click changes the text to `<label> <name>? Click again`, or `<label>? Click again` with no `name`, for 5 seconds.
- For an answer that needs a reason, put the button in a `.choice` with an `input.reason`. The first click opens the box, and the label changes to `Confirm`.

- In a handler of your own, call `arm(btn, text)` on each click. It returns `true` when it armed the button, so stop; it returns `false` on the second click, so go on. Do not keep the armed state in a `data-` attribute or a timer of your own.

| Do | Don't |
|---|---|
| `actButton("Drop", { act: "drop", path, name: "a1700", confirm: "1", label: "Drop" })` | `confirm()` from the browser |
| `if (arm(btn, "Drop a1700? Click again")) return;` | a second hand-written armed state |

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

- Keep prose at `--measure` (76 characters) wide or less. `.md` sets no width: put it in a `panel()`, or give its box `max-width: var(--measure)`.
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

#### Search box

A search box is one text field over a table. It filters the rows by the text.

**Use:** over a table that has more rows than a reader scans. **Not for:** a choice from a fixed set; use a filter in the filter bar.

| Helper | Reference |
|---|---|
| `searchBox(ui, value, placeholder)` | `ui/views/factory-jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Field | The text to search for | | `input[type="search"]` on `--sunk`; `--ctl-h` high; at least 240px wide, fills the row |

- Name what it searches in the placeholder: `Search ids and titles`. The placeholder is the accessible name too.
- Put it above the filter bar, outside the part that redraws, so it keeps the focus. Give its `ui` key to `wireTable({ search })`.
- Send the text to the address with `setQuery({ q })` and draw the table again. Wait about 200 ms after a key. Do not fetch on each key.
- Use one size on every page. The wide field of the Memory page is a deviation.

| Do | Don't |
|---|---|
| `searchBox("jobs-search", f.q, "Search ids and titles")` | `<input type="search">` written by hand |
| a placeholder that names the columns | `Search` |

#### Tabs

Tabs show one pane of a page at a time. A segmented control picks the pane.

**Use:** for two to five panes of one item, where the reader needs one at a time. **Not for:** a filter of a table; use the filter bar. **Not for:** detail that you can fold; use a disclosure.

| Helper | Reference |
|---|---|
| `tabs(label, items, panes, on)`; `wireTabs(root, onTab)` | `ui/views/ideas.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Tab bar | One button per pane, from `seg()` | | as the segmented control; `--sp-12` above the pane |
| 2 | Pane | The HTML of one tab, in a `section[data-pane]` | | the open pane shows, the others have `hidden` |

- `items` is `[[id, label]]`; `panes` maps each id to its HTML. The first item is open unless `on` names another.
- `wireTabs()` switches the panes without a redraw. A view that keeps the pick in `keep()` or in the address gives `onTab` and keeps it there. Wiring a root again adds no listener: the root keeps one, and the last `onTab` is the one it calls.
- Name each tab in one or two words, as the title of its pane.
- Put all the panes in the page, hidden. Do not fetch a pane on a click.

| Do | Don't |
|---|---|
| `tabs("Idea tabs", [["writeup", "Write-up"], ["log", "Log"]], panes, tab)` | `seg()` plus `section` tags written by hand |
| three tabs | a tab bar of nine tabs that scrolls |

#### Select

A select is an inline choice from a list that the data gives.

**Use:** for one choice from many options, inside a field, a setting or a filter bar. **Not for:** a fixed set of two to five options; use a segmented control.

| Helper | Reference |
|---|---|
| `selectBox(label, name, options, value, { id, attrs })` | `ui/views/factory-agents.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Select | The options, with the value selected | | `--sans` `--fs-sm` on `--surface`, border `--rule`, radius `--r-ctl`; `--ctl-h` high |
| 2 | Option | A value and its label; `disabled` for one that cannot be chosen | | |

- `label` is the accessible name. Always give it, even when a visible label stands beside the select.
- `options` are strings, or `{ value, label, disabled }`. Disable an option that is down. Do not leave it out, so the reader sees why.
- Wire the change in the view: a select with no Save button applies on `change`.

| Do | Don't |
|---|---|
| `selectBox("Reviewer model", "model", offers, current)` | a `<select>` written by hand in a table cell |
| a disabled option for a backend that is down | no option for a backend that is down |

#### Field and form

A field is a label over a control. A form stacks fields under one submit button.

**Use:** to file or create something with many values. **Not for:** one setting on a settings page; use a settings list.

| Helper | Reference |
|---|---|
| `field(label, control, { hint, check })`; `inputBox(name, value, { id, type, attrs })`; `form(ui, fields, submit)` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Label | The name of the value | | `--fs-xs`, `--muted`, over the control |
| 2 | Control | An input, a select, a textarea, a file input | | `--sans` `--fs-sm`, border `--rule`; the full width, to 640px |
| 3 | Hint | The format or the effect, in one line | yes | `--fs-xs`, `--muted` |
| 4 | Submit | The button, `primary`, and the form message beside it | | as a button |

- `field(label, control)` wraps the control in its label, so the label names it. A checkbox goes first: `field(text, input, { check: true })`.
- Name the submit button with the verb and the object: `File issue`, not `Submit`.
- Wire `submit` on the `data-ui` key of the form. Show a failure in the `.act-msg` with `say()`. A success reloads or redraws.
- Put a fold around a form that is not the point of the page.

| Do | Don't |
|---|---|
| `form("issue-form", [field("Title", inputBox("title"))], "File issue")` | a form built from `div` and `label` tags by hand |
| `File issue` | `Submit` |

#### Settings list

A settings list is a group of rows. Each row holds one setting: its label, its control and, when it needs one, a Save button.

**Use:** for the settings of a page, such as the interval of a schedule or the model of a role. **Not for:** the fields of a new item; use a form. **Not for:** values to read; use a fact list or a table.

| Helper | Reference |
|---|---|
| `settings(label, rows)`; `setting(label, control, { id, hint, save, attrs })` | `ui/views/gates.js`; `ui/views/factory-agents.js`, which still builds the worker tier checkbox by hand |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | List | The rows, in one group with a name | | at most 720px wide; rows split by a `--rule-2` line |
| 2 | Label | The name of the setting, in a `<label for>` | | `--fs-sm`, `--ink`; 8 to 14rem wide |
| 3 | Control | An `inputBox()` or a `selectBox()`, and the Save button | | `--sp-6` apart; `--ctl-h` high |
| 4 | Hint | The format or the effect | yes | `--fs-xs`, `--muted`, under the control |

- Give the setting that needs a Save button `save: "Save"`. The row is then a form of its own, and the view wires `submit` on the attributes it gives in `attrs`, for example `' data-schedule="suite"'`. A row with no `save` is a `div`: the control applies on `change`.
- Pass the same `id` to `setting()` and to the control, so the label names the control.
- Put the settings of one page in one list, or one list per card. Do not put a control or a Save button in a table cell.
- Show a setting that is read-only as text in the control place. Do not show a disabled control.
- Under 720px the label goes over the control, and the hint under it.
- Show a failure in the row with `say()`, from the Save button.

| Do | Don't |
|---|---|
| `setting("Suite every", inputBox("every", v, { id }), { id, save: "Save" })` | an input and a Save button in a table cell |
| one row per setting, the hint under the control | one Save button for many settings that each apply at once |

#### Edit toggle

An edit toggle turns a value into its editor in the same place. The reader clicks Edit, then Save or Cancel.

**Use:** on a detail page, when most visits only read. **Not for:** a new item; use a form. **Not for:** a setting; use a settings list.

| Helper | Reference |
|---|---|
| `editable(shown, editor)`; `wireEdit(root)`; `.editable` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Container | `.editable`; it gets `.editing` while the reader edits | | |
| 2 | Value | What the value shows, in `.view-only` | | hidden while editing |
| 3 | Editor | The control for the value, in `.edit-only` | | hidden until editing |
| 4 | Buttons | Edit (`data-editor="start"`, `.view-only`); Cancel (`data-editor="cancel"`) and Save (`primary`, a submit button), both `.edit-only` | | as a button |

- `wireEdit(root)` toggles `.editing` on a click of a button with `data-editor`. Cancel resets the forms inside the container. Wiring a root again adds no listener.
- A control in `.edit-only` that sits apart from its form joins it with `form="id"`.
- Save posts the form. Show a failure with `say()` and leave edit mode open. A success reloads the page, which drops edit mode.

| Do | Don't |
|---|---|
| `editable(esc(title), inputBox("title", title))` | the value and the editor as two blocks that the view hides |
| Cancel puts back the old value | Cancel that keeps the typed text |

#### Pager

A pager splits a long table or list into pages of 50 rows. Next replaces the rows with the next 50, so the page
stays one screen of rows and does not grow.

**Use:** under a table of more than 50 rows. **Not for:** a short list; use `moreFold()`.

| Helper | Reference |
|---|---|
| `pager(page, total)`; `pageOf()`; `pageRows()`; `pagedTable()` | `ui/views/issues.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Previous button | `Previous 50` | yes, not on page 1 | the button |
| 2 | Next button | `Next 50` | yes, not on the last page | the button |
| 3 | Range | `51–100 of 345` | | `--num` `--fs-xs` `--fw-mid` tabular, `--muted` |

- For a table that `wireTable()` sorts, filters or searches, use `pager()` with `pageOf()` and `pageRows()`. The page
  number stays in the address as `page`. A change to the sort, a filter or the search goes back to page 1.
- For a table that does not change, use `pagedTable()`. It turns the page in place.
- Do not use both under one root.
- Next names the rows on the next page, up to 50: `Next 12` on the last page.
- After a turn, the top of the table is in view.
- A page number past the end shows the last page.

| Do | Don't |
|---|---|
| `Previous 50`, `Next 50` with `51–100 of 345` | `Show 50 more`, which grows the page; page numbers |

#### Empty state

An empty state shows that there is nothing, that data loads, or that the data did not load.

**Use:** in place of a table, a chart or a list that has nothing to show. **Not for:** the result of an action; use the form message.

| Helper | Reference |
|---|---|
| `empty(line)`, `loadingLine(what)`, `error(line, hint)`, `notice(line, bad, id)`; `loading(title)` in the router only | `ui/views/jobs.js` |

| # | Part | Holds | Optional | Style |
|---|---|---|---|---|
| 1 | Line | `No data`; an error line is one sentence | | `--fs-sm`, `--muted`; an error `--stuck` |
| 2 | Loading | `Loading <what>…` | | `--muted` |

- The router shows `loading()` while a page loads, and `error()` when the first load fails. A view does not call them for its own data.
- For a section that loads after the page, use `loadingLine(what)`: `Loading the diff…`.
- Use `error(line, hint, { detail })` for a second fetch inside a card that failed. The line is `Could not load X.`; with no hint, it tells the reader to check aleph-ui and reload. The upstream message goes in `detail`, in a Technical details fold.
- Use `notice(line, bad)` for a note above data that still shows: a stale reload (`bad`, `role="alert"`) or a partial count. Do not write a `<p>` for it by hand.
- `empty()` takes no hint. The `error()` hint is text.

| Do | Don't |
|---|---|
| `empty()` | `<p class="quiet">No data</p>` by hand, or a sentence and a hint |
| `error("Could not load the agents.", hint, { detail })` | `Error: fetch failed` |

## States

| State | Rule |
|---|---|
| Focus | a `2px solid var(--focus)` ring, 2px outside the control, on `:focus-visible` |
| Hover | a border goes to `--ink-2`, or text to `--ink`; rows and nav items go to `--sunk`; a metric card that is a link or a selector takes a `--run` border |
| Pressed: segmented option | `aria-pressed="true"`; `--ink` on `--rule-2`, `--fw-strong` |
| Pressed: metric card | `aria-pressed="true"`; `--raised` with a `--run` border |
| Pressed: bar row | `aria-pressed="true"`; `--sunk`, label `--fw-strong` |
| Selected | `aria-selected="true"` on a row that shows its detail beside it; `--sunk` with an inset 2px `--run` bar |
| Current | `aria-current` on the sidebar link or the contents entry; an inset 2px `--ink` bar |
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
| Status entry | Its label and icon take the tone of the status sentence from `/api/status`: `alert` is `--stuck`, `warning` and `ask` are `--need`, `fine` is `--ink`, white on the dark theme |
| Page | `.page`: 2400px max, `28px 24px 64px` padding, `20px 16px 48px` at 720px |
| Browser | `::selection` is `--sel`; scrollbars are thin, `--rule` on transparent |
| Grid | `.tiles` holds metric cards; `.pair` holds two cards side by side, stacked under two cards of width; `.lanes` holds lanes; `.trio` holds chart panels; `.browse` is a list with its detail beside it, one column under 1100px |

- **List page:** page head, metric cards, then cards.
- **Detail page:** crumb, page head, status row, KPI strip, then detail panels.
- **Long page:** page head, then `toc()` around the rest (Structure, Contents).

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
| Dates with no time: `Oct 28` vs `10/28` | `ui/views/issues.js`, `ui/views/memory.js` | Chris's decision |
| Cost axis keeps cents (`minInterval: 0`, labels by `money()`) | `ui/chart.js` and `costFrame()` in `ui/views/factory-agents.js` | allowed |
| Sections built from `sectionHead()` with no card box: they hold cards, and a card does not sit in a card | Memory Health in `ui/views/memory.js`; the Status Alerts and lanes in `ui/views/now.js`; the Jobs and Sessions pages, `ui/views/jobs.js` and `ui/views/sessions.js`, no longer have one | allowed |
| The feed row's tones (`alert`, `warning`, `fine`) are its own, not `tone()` | `eventRow()` in `ui/views/now.js` | follow-up |
| Parts of the Status page written by hand, with no helper: the Pipeline's stage nodes (`div.pnode`), the feed's rows (`div.event-row`, `div.event-brief`) and the lane card's face (`article.lane-card`) | `renderPipeline()`, `feedRow()`, `briefRow()`, `laneCard()` in `ui/views/now.js` | follow-up |
| Light `--series-3` to `--series-5` are under 3:1 on `--surface` (2.82, 2.17, 2.69); the legend and the tooltip carry the key | `ui/app.css` | aleph-1806 (pending) |
| Dark `--chart-6` and `--chart-7` are outside the lightness band, and `--chart-7` reads grey; light `--chart-6` and `--chart-7` are 6.5 apart under deuteranopia | `ui/app.css` | aleph-1807 (pending) |
| The session page draws only the open tab and a tab click reloads the page: the chat pages 20 turns, the table reads them all. Its status row has no state or priority, only labels: a session has neither | `renderSession()` in `ui/views/session.js` | allowed |
| Charts outside the chart panel: the Agent Time bar, the session waterfall | `ui/views/speed.js`, `ui/views/session.js` | allowed |
| A lens result is a hand `iframe.lens-frame`, sandboxed: no helper for a result page; the Log pane's lines are a hand `ul` | `renderIdea()` in `ui/views/ideas.js` | follow-up |
| Parts of the Ask card written by hand, with no helper: the Recommended mark on a choice (`span.rec-note`), the act message (`span.act-msg`, from `actMsg()`), the Diff stat block (`div.ev.one` over `pre.stat`) and the date and runtime of the meta row (`span.num.date`, `span.num.dur`) | `askChoice()`, `actMsg()`, `askDetails()`, `metaRow()` in `ui/views/cards.js` | follow-up |
| Shell parts written by hand, with no helper: the sidebar (`#nav`, its mark, the log-out link), the collapse button, the offline banner | `ui/router.js`, `ui/index.html` | follow-up |
| The outcome bar shows `empty()` with no card | `bar()` in `ui/views/speed.js` | follow-up |
| The `@container` queries at 560px (`pipeline`) and 420px (a card) have no breakpoint token: a container query cannot read a custom property | `ui/app.css` | allowed |
| The `@media (min-width: 721px)` query for the collapsed sidebar has no breakpoint token: a media query cannot read a custom property | `ui/app.css` | allowed |
| The Herald card keeps a visible `--rule` border and a pulse ring: the pulse draws on that border, and aleph-1913 changes the Herald's states | `.herald-card` in `ui/app.css` | aleph-1913 (pending) |
| The chart's gridline opacity (0.5) and stacked-area opacity (0.6) are literals: no token for an ECharts option | `ui/chart.js` | follow-up |
| The colour probe's `#000` is a literal: it only detects a colour the canvas rejects, and nothing shows it | `ui/views/kit.js` | allowed |
| The Memory rows are hand `li.mrow` and `tr.mrow`: each takes the selection attributes (`tabindex`, `data-id`, `aria-selected`), which `row()` and `cell()` cannot, and a cell with markup is a hand `<td>`, the time one a `td.time` | `noteRow()`, `ruleRow()`, `eventRow()`, `cardRow()` in `ui/views/memory.js` | follow-up |
| The Memory Source cell is a hand `td.mono` with a link to the memory's page: a rule, a skill or a note has a title, not an ID, so `idLink()` does not fit | `ruleRow()` in `ui/views/memory.js` | allowed |
| The legend of the Memory read chart uses `c-use`, `c-stale` and `c-never`, the classes of its meter segments, not timeline classes: no timeline class has the colour of "never" (`--rule`) | `readChart()` in `ui/views/memory.js` | follow-up |
| The Memory page head has a Window control that does nothing: the memory API takes no window, and `scope().bar()` always draws one | `renderMemory()` in `ui/views/memory.js` | follow-up |
| The Memory inspector's buttons carry `data-mact` and a handler of their own, not the router's `act`: a write reads the Why field and the open memory, and a form submits to the same handler | `act()`, `write()` in `ui/views/memory.js` | allowed |
| A success rate under a hand-picked line (`WARN_RATE`) tones its cell `warn` by hand | `roles()` in `ui/views/factory-agents.js` | follow-up |
| The Roles table's rows are hand `<tr>`s and its Failed Jobs link a hand `a.failed-jobs` | `roles()` in `ui/views/factory-agents.js` | follow-up |
| A Jobs trend chart's p90 line takes the `hot` tone | `trendFrame()` in `ui/views/factory-jobs.js` | allowed |
| The Checks, Build Time by Model and Jobs cards of the Jobs page show no count | `renderFactoryJobs()` in `ui/views/factory-jobs.js` | follow-up |
| A table row's fold chevron is a hand `<button class="fold">`: no helper for a row toggle | `renderRow()` in `ui/views/issues.js` | follow-up |
| The timeline's lane, bars, waits and marks are hand spans: no helper for a bar on a time axis. `panel()` writes its aside as a hand `span.quiet` | `renderTimeline()`, `panel()` in `ui/timeline.js` | follow-up |
| The chart's list of links for the keyboard is a hand `ul.sr`: no helper for a visually hidden list | `panel()` in `ui/chart.js` | follow-up |
| The Issue page's Fields panel is a hand `dp-panel`, and its blocked line a hand `dp-blocked`: `panel()` needs a heading, and `blockersHtml()` writes only the items | `renderIssue()` in `ui/views/issues.js` | follow-up |
| A textarea and a checkbox are written by hand: no helper | `ui/views/issues.js`, and the Memory editor in `ui/views/memory.js` | follow-up |
| The Job page's Waits-on block is a hand `dp-blocked`, as on the Issue page: `blockersHtml()` writes only the items | `renderJob()` in `ui/views/jobs.js` | follow-up |
| Quiet labels inside a line are hand `span.quiet`: the Next line, the check name after a failed test, the `logs:` label of a run's log buttons, a run's job ID in its event, the Work lane's head. `note()` makes a whole line, not a label | `renderJob()`, `logButtons()`, `jobEvent()`, `jobSegments()` in `ui/views/jobs.js` | follow-up |
| A transcript's steps are hand `div.step`: no helper for a tool call with its input and result | `renderTranscript()` in `ui/views/jobs.js` | follow-up |
| Parts of the Automation page written by hand, with no helper: the Rules row (`tr.rule`, and its name cell of a bold name, a `code` reason and a note), the `div.held` that wraps the held-path chips, and the log content cell with its clamp button | `renderRules()`, `renderHeld()`, `renderLog()` in `ui/views/gates.js` | follow-up |
| The File an Issue Project select takes its options from the registry after the page is drawn, written as hand `<option>` tags | `projectOptions()` in `ui/views/issues.js` | follow-up |

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
| `ui/views/kit.js` (1) | a contrast ratio, `toFixed(2)` |

### Inventory

From `bun skills/design-language/scripts/inventory.ts ui --summary`.

| group | kind | count |
|---|---|---|
| colour | literal | 6 |
| colour | token-def | 99 |
| effect | literal | 50 |
| effect | token-use | 13 |
| format | helper-bypass | 43 |
| size | literal | 127 |
| size | token-def | 21 |
| size | token-use | 622 |
| type | literal | 25 |
| type | token-def | 42 |
| type | token-use | 68 |
