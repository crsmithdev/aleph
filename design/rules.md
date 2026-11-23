# Principles

### One token set, two themes
- id: one-token-set
- scope: global
- reason: A view that uses only tokens gets dark mode free.

Colours are custom properties on `:root` in `ui/app.css`, set again for dark by `@media (prefers-color-scheme: dark)` and by `:root[data-theme="dark"]`. Light is lavender. Dark is Palenight.

### Shared helpers build the parts
- id: shared-helpers
- scope: global
- reason: A fix in one helper fixes every page.

Views call `ui/views/lib/html.js` for parts and `ui/views/lib/format.js` for values. The CSS is in `ui/app.css`.

### Meaning is a tone
- id: meaning-is-tone
- scope: global
- reason: One state has one colour on a badge, a series and a card, so a reader learns it once.

A state is `run`, `done`, `need`, `error`, `quiet` or `parked`, from `tone()` in `ui/views/lib/html.js`. A tone comes only from `tone(state)`. A name that is not a state, such as an actor, is a `chip()`. A chart series for a state takes the colour of `tone(state)`.

### Numbers are tabular
- id: numbers-tabular
- scope: global
- reason: Digits line up in a column.

Numbers use tabular figures, at the right. The class is `.num`. No other rule sets `font-variant-numeric`.

### Plain text states
- id: plain-text-states
- scope: global

An empty state is `No data` from `empty()`, the same on every page. A missing value is `–` from `miss(reason)`, with the reason as its title (see `value-missing`), never `N/A` or `0`. A zero stays `0`.

### Be terse
- id: be-terse
- scope: global

A note, a qualifier or a caption is one or two words. Do not fill a space because it is there. Do not explain what the title, the axis or a tooltip already says. A definition goes in a `title` tooltip or nowhere.

# Tokens

### A colour is a token
- id: colour-token
- scope: global
- reason: Both themes follow one edit.
- except: ui/app.css .chat .clamp: the black mask fades the text.
- except: ui/app.css .wf-detail .clamp: the black mask fades the text.
- except: ui/app.css .cmd .cp: a `color-mix()` of tokens.
- except: ui/views/design.js: the colour probe uses a literal black. It only detects a colour that the canvas rejects, and nothing shows it.

Use a colour token for every colour. In a chart, use a token that `readTokens()` reads (`TOKENS` in `ui/views/lib/chart-theme.js`). Do not write a hex colour in a rule.

### A size is a token
- id: size-token
- scope: global

Use `--fs-*`, `--r-*`, `--sp-*`, `--dim`, `--ctl-h` and `--bar-h` for sizes, radii, spacing, dimming and heights. Do not write a px literal for them.

### Size literals
- id: size-literal
- scope: global

A width, a height, a position offset, a hairline, and an `em`, `ch`, `%` or `vh` value stay literal. A padding, margin, gap or scroll-padding outside `:root` is `0`, a hairline, or built from `--sp-*` and `--gap`. A value above `--sp-28` is a `calc()` of tokens, such as `calc(2 * var(--gap))`. A negative margin is `calc(-1 * var(--sp-2))`, not a px literal. A width is a literal, not a `--sp-*` token.

### A displayed value has a helper
- id: value-token
- scope: global

Every displayed value goes through the helpers in Content, Values (`value-helpers`). Do not format a value by hand: write `dur(245)`, not a `Math.floor(s / 60)` expression.

### A media query is a literal
- id: breakpoint-literal
- scope: global
- except: ui/app.css @media (min-width: 721px): the collapsed sidebar query has no token, because a media query cannot read a custom property.
- except: ui/app.css @container (560px, 420px): a container query cannot read a custom property.

The breakpoints are 720px and 1100px, written as literals, as `@media` takes no tokens. Do not write another width, such as 800px. There are two `@container` widths, written as literals: 560px (`.card.duo`) and 420px (`.tile`, `.issue-row`).

### Motion
- id: motion
- scope: global

Use `.15s ease-out` on borders and backgrounds. Use no animation. Set ECharts `animation: false`. Scroll smoothly only when `prefers-reduced-motion` is not `reduce`.

# Colour

### Colour use
- id: colour-use
- scope: global

Use a tone for a state, such as `--error` on a failed job, not for decoration. Use `--series-*` for roles, with the same role in the same colour on every chart, and do not make a new colour per chart. Fold an eighth key into `Other` and make no colour for it. Show a value or a label in `--ink` next to its swatch, not in the colour of its series. Put text on its own `-bg`: `--need` on `--need-bg`, never `--need` on `--error-bg`.

### Contrast
- id: contrast
- scope: global
- reason: A reader must read text and see a mark in both themes.

The minimum is 4.5:1 for text and 3:1 for a mark. `ui/error-contrast.test.ts` tests the error pair and the dark `--muted` pairs. When you change a data colour, run `validate_palette.js` from the `dataviz` skill on the seven series colours, once with `--mode light` and once with `--mode dark`, each with the `--surface` value of that theme. The table gives the ratios of the pairs that were checked. Only these pairs are checked.

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--surface` | 13.64 | 12.07 |
| `--ink-2` on `--surface` | 8.02 | 8.02 |
| `--muted` on `--surface` | 5.43 | 5.43 |
| `--muted` on `--bg` | 4.93 | 6.21 |
| `--muted` on `--sunk` | 4.57 | 6.75 |
| `--muted` on `--raised` | 4.57 | 4.67 |
| `--need` on `--need-bg` | 5.13 | 6.50 |
| `--error` on `--error-bg` | 4.78 | 4.54 |
| `--done` on `--done-bg` | 5.17 | 5.36 |
| `--run` on `--run-bg` | 4.99 | 4.61 |
| `--hot` on `--surface` | 4.65 | 5.80 |
| `--focus` on `--surface` | 5.21 | 5.67 |
| white on `--seg-reran` | 4.70 | 4.70 |

### Palettes
- id: palettes
- scope: global

The dock's theme picker sets `data-palette` on `<html>`. A palette in `ui/app.css` sets `--bg`, `--surface`, `--sunk`, `--raised`, `--ink`, `--ink-2`, `--muted`, `--rule`, `--rule-2` and `--focus`, for light and for dark. Every other token stays, so a state keeps its colour in each palette.

Give a new palette all ten tokens, in light and in both dark blocks. Do not give a palette a status or chart colour. The values and their sources are in `docs/mocks/theme-palettes/` (`build.py`). `ui/app.css` moves a text colour toward `--ink`, or toward black or white, until it reaches 4.5:1 (`contrast`), so some values differ from the source.

| Palette | Accent |
|---|---|
| Dracula | purple |
| Iceberg | blue |
| Lavender (no `data-palette`) | violet |
| Nightfox | blue |
| Nord | frost cyan |
| Nord Aurora | Aurora purple |
| Nord Light | frost cyan; Nord Light's darker keyword blue in light |
| Nordfox | blue; Nord Light in light |
| One | blue |
| Palenight Mild | violet; Lavender in light |
| Palenightfall | blue; Lavender in light |
| Poimandres | teal; its light variant is aleph's own |
| Solarized | blue |
| Tokyo Night | blue |
| Tomorrow | blue |

### Theme picker
- id: theme-picker
- scope: global

The picker's top row picks System, Light or Dark. Light and Dark set `data-theme` on `<html>` on every page, and System sets none.

### The dock bridge
- id: dock-bridge
- scope: global
- reason: One block serves both themes.

The dock widgets in `aleph-tools` read the `--dock-*` tokens. The dock floats at the bottom right (`layout-dock`). Each `--dock-*` token points at a base token.

# Type

### Weights
- id: weight-token
- scope: global
- except: ui/app.css .mark: weight 700 stays a literal.

A font weight is `--fw-text`, `--fw-mid` or `--fw-strong`.

### Line height and case
- id: line-height
- scope: global

A line height is a unitless number, such as `line-height: 1.45`, not a length. Uppercase is for the small keys that `--ls-caps` lists, not for a section heading.

### Tracking
- id: tracking
- scope: global

Display and brand type use `--ls-display`: `.mark`, `.shead .say`, `.shead .asof`, `.sh h2`, `.ph h1`, `.tile b`. Uppercase keys use `--ls-caps`: `#nav li.head`, `.tile .k`, `.ins h4`.

# Space and shape

### A dot
- id: dot-size
- scope: global

A dot is `--dot-s`, `--dot-m` or `--dot-l` wide and high. Its circle is `--r-pill`, never `50%`.

### Prose width
- id: measure
- scope: global

All prose is at most `--measure` wide. Do not write `80ch`: use `max-width: var(--measure)`.

### Sticky offset
- id: sticky-top
- scope: global

A `position: sticky` `top` is `--sp-8` or `--sp-16`.

# Content

### Value helpers
- id: value-helpers
- scope: global
- except: ui/views/lib/format.js, ui/views/lib/html.js: the helpers.
- except: ui/activity.ts, ui/views/issues.js: date arithmetic, not display.
- except: ui/views/session.js, ui/views/lib/timeline.js, ui/views/lib/bars.js, ui/views/memory.js: percent widths for CSS.
- except: ui/api/skills.ts: a server log line.
- except: ui/views/design.js: a contrast ratio, `toFixed(2)`.
- except: ui/views/issues.js, ui/views/memory.js: a date with no time shows as `Oct 28`, not `10/28`. Chris decides.

Every displayed value goes through its helper in `ui/views/lib/format.js` or `ui/views/lib/html.js`. The Missing column gives what the helper shows for no value. Show that, and do not replace it.

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
| Id | a52 | `idLink()`, `repoIdLink()`; see [Naming](../docs/naming.md) | none |
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

### A missing value
- id: value-missing
- scope: global

A missing value is always `–`, from the format helper. When there is no helper, write `miss(reason)`: the `–` carries the reason as its title. Zero stays `0`.

### Integers
- id: value-count
- scope: global

Show every integer through `count()`.

### A count with a noun
- id: value-plural
- scope: global

Write a count with its noun through `plural(n, one, many)`: `1 run`, `2 runs`. Give `many` when the plural is not `one` + `s`. A view has no copy of its own.

### Code in a line of text
- id: value-code-text
- scope: global

Show code in a line of text only through `codeText()`.

### Meta line
- id: value-meta
- scope: global

Make a line of facts about an item with `meta(parts)`: a muted `--fs-xs` line, its parts split by a `·` that the CSS draws. An empty part is left out.

### Commit
- id: value-commit
- scope: global

Make a commit with `shaLink(hash, url)`: the short hash, an `idLink()` when there is a URL, a `span.idp` when there is none. `idLink(id, href)` also draws a `span.idp` when `href` is missing.

### Side note
- id: value-note
- scope: global

Make a side note with `note(text)`: `--fs-sm`, `--muted`, no margin. It replaces `p.quiet`, `p.quiet.q` and `p.hint` used as a side note.

### Sub-head
- id: value-sub-head
- scope: global

Make the head of a part inside a card or a panel with `subHead(text)`: small capitals, `--muted`, sentence case. It is the only heading inside a card or a panel.

### Title case
- id: words-title-case
- scope: global

Write a page title, a section title and a column header in Title Case. Write these words in lower case, unless they are first: a, an, the, and, but, or, nor, as, at, by, for, from, in, of, on, per, to, vs, with.

### Sentence case
- id: words-sentence-case
- scope: global

Write a key of a fact list and the label of a button in sentence case.

### Lower case
- id: words-lower-case
- scope: global

Write a state, a priority and a chart key in lower case. States come from [Naming](../docs/naming.md). Priorities are `critical`, `high`, `medium`, `low`.

### Count after a title
- id: words-count
- scope: global

Show a count as a muted number after its title, not in brackets.

### Empty text
- id: words-empty
- scope: global

Write an empty state with `empty()`: `No data`, with no hint. Give it another line only for a state that is not missing data, such as `Langfuse off` or `Select a row`, in at most three words.

### Notes and captions
- id: words-caption
- scope: global

Write a note, a qualifier or a caption in one or two words: `stale`, `p50 weekly`. Put more in a `title` tooltip.

### Error line
- id: words-error
- scope: global

Write an error line as `Could not load X.`, with no hint. Put the upstream message in a Technical details fold (`error()` with `detail`).

### Offline text
- id: words-offline
- scope: global

Offline, the page says "The server is unreachable. Showing the last data." (`ui/index.html`).

### Word examples
- id: words-examples
- scope: global

| Do | Don't |
|---|---|
| `Jobs per Item`, `Linked from` | `Jobs Per Item`, `jobs per item`, `Linked From` |
| `Running` with a muted `3` after it | `Running (3)` |
| `Next 50` | `Click here to load more results` |
| `running`, `landed`, `critical` | `Running`, `LANDED` |
| `empty()`, which shows `No data` | `No agent job on an issue ended in the last hour.` with the hint `Widen the window or clear the project.` |
| `stale`, with the off-machine share in the card's tooltip | `2% off this machine, stale data` |
| `Could not load the agents.` and the upstream message in a Technical details fold | `Error: fetch failed`, or a hint such as `Check that aleph-ui is running, then reload.` |
| `Loading Jobs…` with the spinner before it | a spinner with no text, or `No data` before the first fetch returns |

# Components

### Build with the helper
- id: component-helper
- scope: global

Build each component with its helper. Do not write its markup by hand. If a part has no helper, write it by hand and list it in `deviations`.

### Tokens in a component
- id: component-tokens
- scope: global

Use tokens for all colours, sizes, spaces and radii (`colour-token`, `size-token`).

### Values in a component
- id: component-values
- scope: global

Format each value with its helper, and show a missing value as `value-missing` gives. Write titles, keys, labels and counts as `words-title-case` and the other `words-*` rules give.

### Tone of a state
- id: component-tone
- scope: global

Get the colour of a state from `tone()`. Do not choose a tone by hand.

### An empty component
- id: component-empty
- scope: global

When a component on a list page has nothing to show, put `empty()` in its place. Keep the card around it. On a detail page, leave the panel out.

### Control states
- id: component-states
- scope: global

Give each control the states that the `state-*` rules give.

### Ellipsis and icons
- id: component-title
- scope: global

Give text that can end in an ellipsis its full text in `title`. Give a control with only an icon an `aria-label` and the same `title`.

### A new component
- id: component-new
- scope: global

When you add a component or a state, add a file in `design/components/` and a specimen on `#/design`.

### The shape of a component file
- id: component-file
- scope: global

Each file in `design/components/` has the same parts, in this order. Its first paragraph says what the component is. `Use` and `Not for` say when to use it, and what to use in its place. `Helper` names the function that builds it, and the view that follows the rules best. `Parts` lists each part, what it holds, whether it is optional, and its style. The helper applies the style, and you do not set it. `Rules` says how to build it, then what it holds, how it behaves, and how it shows on a phone. `Do and don't` gives examples.

# Page

### One question
- id: page-question
- scope: global

A page answers one question for the first screen: what is wrong, then what the page lists. Its parts come in one order, and a part that has nothing to show is not drawn.

### Page grammar
- id: page-grammar
- scope: global

A page has these parts, in this order.

1. The page head: the title in the display face, the view tabs beside it, the scope control at the right. The scope control shows only on a view it changes.
2. The attention rows: none, or one for each problem.
3. The facts line (list view) or the figure band (analysis view).
4. List view: one list surface with a search, filters of one control type and the rows. The inspector sits at the right and stays in view. Under 1100px it goes below the list.
5. Analysis view: chart panels 2 across in `.pair`, then the tables behind them.

### The first screen
- id: page-first-screen
- scope: global
- reason: Anything wrong must show with no scroll (Principle 3 of PRINCIPLES.md).

The page named X opens on the list of X. Anything wrong shows at the top with no scroll.

### A row hides its defaults
- id: page-row-defaults
- scope: global

A row hides its defaults: no `medium`, no `aleph`, no zero. A column that shows only a default goes.

### A row carries its evidence
- id: page-row-evidence
- scope: global

A row carries its evidence: a run strip, an outcome bar or a rate against its baseline (`row-bars`).

### No metric cards first
- id: page-no-cards-first
- scope: global

Do not open a page with metric cards. A list view has the facts line (`facts-line`). An analysis view has the figure band (`figure-band`).

### Page kinds
- id: page-kinds
- scope: global

A list page has the page grammar: page head, attention rows, facts line, then one list surface. An analysis page has the page head, attention rows, figure band, charts 2 across, then tables. A detail page has a crumb, the page head, a status row, a KPI strip, then detail panels. A long page has the page head, then `toc()` around the rest (`contents`).

# States

### Focus
- id: state-focus
- scope: global

Focus is a solid `--focus` ring, offset outside the control, on `:focus-visible`. Use `:focus-visible`, not `:focus`, which also rings on a click. Inside a container, use an inward outline offset (`.seg button:focus-visible`), so the container does not clip the ring.

### Hover
- id: state-hover
- scope: global

On hover, a border goes to `--ink-2`, or text to `--ink`. Rows and nav items go to `--sunk`. A metric card that is a link or a selector takes a `--run` border.

### Pressed segmented option
- id: state-pressed-seg
- scope: global

A pressed segmented option has `aria-pressed="true"`, `--ink` on `--rule-2`, and `--fw-strong`.

### Pressed metric card
- id: state-pressed-metric
- scope: metric-card

A pressed metric card has `aria-pressed="true"`, `--raised` and a `--run` border.

### Pressed bar row
- id: state-pressed-bar
- scope: meter

A pressed bar row has `aria-pressed="true"`, `--sunk` and a label in `--fw-strong`.

### Selected
- id: state-selected
- scope: global

A row that shows its detail beside it has `aria-selected="true"`, `--sunk` and an inset thin `--run` bar at the left.

### Current
- id: state-current
- scope: global

The sidebar link or the contents entry has `aria-current` and an inset thin `--ink` bar at the left.

### Parked
- id: state-parked
- scope: global

A parked item has a `box-shadow: inset` ring.

### Disabled
- id: state-disabled
- scope: global

A disabled control has opacity `--dim` and a wait cursor, while a request runs.

### Active
- id: state-active
- scope: command

An active command box moves down a little.

# Layout

### Sidebar
- id: layout-sidebar
- scope: global

`#nav` is 208px open and 48px when collapsed (`.shell.collapsed`). At 720px and narrower, it is a sticky bar at the top: one row, the links scroll sideways, and the current link scrolls into view.

### Dock
- id: layout-dock
- scope: global

`#dock-host` is made by aleph-tools `dock({ rowBelow: 720 })`: a fixed column of buttons at the bottom right. At 720px and narrower, it is a row in the corner. A panel opens at the left of its button. See `dock-bridge`.

### Attention dot
- id: layout-attention-dot
- scope: global

An entry gets a tone dot at the right of its link while its page has an attention row (`attention-rows`). `/api/attention` gives the rows. The dot reads the same rows as the page and changes with them. A collapsed sidebar puts the dot on the icon.

### Status entry
- id: layout-status-entry
- scope: global

The label and icon of the Status entry take the tone of the status sentence from `/api/status`: `alert` is `--error`, `warning` and `ask` are `--need`, `fine` is `--ink`, white on the dark theme.

### Page box
- id: layout-page
- scope: global

`.page` is 2400px at most. Its padding is `--sp-28` above, `--sp-24` at the sides and room below for the dock. At 720px and narrower the padding is `--sp-20` above and `--sp-16` at the sides.

### Browser
- id: layout-browser
- scope: global

`::selection` is `--sel`. Scrollbars are thin, `--rule` on transparent.

### Grids
- id: layout-grid
- scope: global

`.tiles` holds metric cards. `.pair` holds two cards side by side, stacked under two cards of width. `.trio` holds two or three chart panels. `.quad` holds four in one row. `.browse` is a list with its detail beside it, one column under 1100px.

# Views

### A view module
- id: view-module
- scope: global

A page is a view module in `ui/views/`. The router reads its `view` object (the comment at the top of `ui/views/lib/router.js`).

| Field | Holds |
|---|---|
| `path`, `title` | the route and the page title |
| `group`, `order`, `icon`, `nav` | the place in the sidebar; `icon` is a Font Awesome name; `nav: false` leaves the page out |
| `api` | the URL of the data |
| `render(data, params, query)` | the HTML of one `<div class="page">`; a page of views calls `pageViews()` (`page-head`) |
| `mount(root, data, query)` | the wiring, after each render |
| `refresh`, `live` | seconds between reloads; `live: true` also redraws on a pushed change |

### Wire in mount
- id: view-mount
- scope: global
- reason: `mount()` runs again after every redraw, on the same `#view` root, so each `addEventListener` adds one more handler.

Wire with `root.onclick =` and the other `on*` properties. Do not call `addEventListener` in `mount()`.

### A handler across routes
- id: view-document-handler
- scope: global

A handler that must stay across routes goes on `document`, once, when the module loads. It checks its target.

### The failure of the api
- id: view-api-failure
- scope: global

Do not catch the failure of the view's own `api`: the router shows it.

# Accessibility

### Colour alone
- id: a11y-colour-alone
- scope: global

Bar tones rely on colour alone. A diff line also keeps its `+` or `-`. For contrast, see `contrast`.

### A clickable row
- id: a11y-row
- scope: global

A row that is not a button but takes a click has `tabindex="0"` and opens on Enter and Space.

### Screen reader text
- id: a11y-sr
- scope: global

Hide a label that is only for screen readers with `.sr`.

### Smooth scroll
- id: a11y-motion
- scope: global

Scroll smoothly only when `prefers-reduced-motion` is not `reduce`.

### Sort and pressed
- id: a11y-aria
- scope: global

Use `aria-sort` on sort headers, and `aria-pressed` on selector cards and segmented options.

# Deviations

### Known deviations
- id: deviations
- scope: global
- reason: A value that the rules do not allow is a deviation, listed here with its fix.

Each row is a place that leaves a rule. The Fix column says what happens to it. A part that has no helper and is written by hand goes here.

| Deviation | Where | Fix |
|---|---|---|
| Time column names differ | Tables | follow-up |
| Cost axis keeps cents (`minInterval: 0`, labels by `money()`) | `ui/views/lib/chart.js` and `costFrame()` in `ui/views/factory-agents.js` | allowed |
| Sections built from `sectionHead()` with no card box: they hold cards, and a card does not sit in a card | the Status Alerts in `ui/views/now.js`; the Jobs and Sessions pages, `ui/views/jobs.js` and `ui/views/sessions.js`, no longer have one | allowed |
| The feed row's tones (`alert`, `warning`, `fine`) are its own, not `tone()` | `eventRow()` in `ui/views/lib/feed.js` | follow-up |
| Parts of the Status page written by hand, with no helper: the feed's rows (`div.event-row`, `div.event-brief`) | `feedRow()`, `briefRow()` in `ui/views/lib/feed.js` | follow-up |
| The session page draws only the open tab and a tab click reloads the page: the chat pages 20 turns, the table reads them all. Its status row has no state or priority, only labels: a session has neither | `renderSession()` in `ui/views/session.js` | allowed |
| A chart outside the chart panel: the session waterfall | `ui/views/session.js` | allowed |
| Parts of the Ask card written by hand, with no helper: the Recommended mark on a choice (`span.rec-note`), the act message (`span.act-msg`, from `actMsg()`), the Diff stat block (`div.ev.one` over `pre.stat`) and the date and runtime of the meta row (`span.num.date`, `span.num.dur`) | `askChoice()`, `actMsg()`, `askDetails()`, `metaRow()` in `ui/views/lib/ask-cards.js` | follow-up |
| Shell parts written by hand, with no helper: the sidebar (`#nav`, its mark, the log-out link), the collapse button, the offline banner | `ui/views/lib/router.js`, `ui/index.html` | follow-up |
| The Herald card keeps a visible `--rule` border and a pulse ring; the pulse draws on that border | `.herald-card` in `ui/app.css` | follow-up |
| The chart's gridline opacity and stacked-area opacity are literals: no token for an ECharts option | `ui/views/lib/chart.js` | follow-up |
| A Jobs trend chart's p90 line takes the `hot` tone | `trendFrame()` in `ui/views/factory-jobs.js` | allowed |
| The Checks, Build Time by Model and Jobs cards of the Jobs page show no count | `renderFactoryJobs()` in `ui/views/factory-jobs.js` | follow-up |
| The timeline's lane, bars, waits and marks are hand spans: no helper for a bar on a time axis. `panel()` writes its aside as a hand `span.quiet` | `renderTimeline()`, `panel()` in `ui/views/lib/timeline.js` | follow-up |
| The chart's list of links for the keyboard is a hand `ul.sr`: no helper for a visually hidden list | `panel()` in `ui/views/lib/chart.js` | follow-up |
| The Issue page's Fields panel is a hand `dp-panel`, and its blocked line a hand `dp-blocked`: `panel()` needs a heading, and `blockersHtml()` writes only the items | `renderIssue()` in `ui/views/issues.js` | follow-up |
| A textarea and a checkbox are written by hand: no helper | `ui/views/issues.js` | follow-up |
| The Job page's Waits-on block is a hand `dp-blocked`, as on the Issue page: `blockersHtml()` writes only the items | `renderJob()` in `ui/views/jobs.js` | follow-up |
| Quiet labels inside a line are hand `span.quiet`: the Next line, the check name after a failed test, the `logs:` label of a run's log buttons, a run's job ID in its event, the Work lane's head. `note()` makes a whole line, not a label | `renderJob()`, `logButtons()`, `jobEvent()`, `jobSegments()` in `ui/views/jobs.js` | follow-up |
| A transcript's steps are hand `div.step`: no helper for a tool call with its input and result | `renderTranscript()` in `ui/views/jobs.js` | follow-up |
| Parts of the Automation page written by hand, with no helper: the `span.held-paths` run of `code` paths in a setting row: no helper for a list of paths | `renderHeld()` in `ui/views/gates.js` | follow-up |
