# UI design audit

The design-language skill in Audit mode, run over all of `ui/` against
`docs/design.md` on main at 70fdfe948. Items 1 to 6 of
`docs/findings/2026-11-03-ui-design-fixes.md` are on main; this audit reads the
code after them.

## Method

1. `bun skills/design-language/scripts/inventory.ts ui > inventory.tsv` gives
   1007 rows.
2. A script marks each row against the doc: **token** (a token definition or
   use), **follows**, **deviates** (names the rule), **new** (the doc has no
   rule), or **false-positive** (not a value).
3. Tables, components, formats and copy were read from the code, because the
   inventory does not cover them.

No page was rendered in a browser. Phone-width behaviour and contrast are
read from the code and the doc, not seen.

## Counts per mark

| Mark | Rows |
|---|---|
| token | 327 |
| follows | 113 |
| deviates | 67 |
| new | 498 |
| false-positive | 2 |
| total | 1007 |

Deviations by group: `font-weight` 36, colour 13, format 10, `z-index` 4,
`box-shadow` 2, `border-radius` 1, `@media` 1.

New rows by kind: spacing (`gap`, `padding`, `margin`) 337, component
dimensions (`width`, `height`, `top` and the like) 137, `opacity` 12,
`letter-spacing` 7, formats the doc does not cover 5.

False positives: `ui/views/efficiency.js:113` (`#eff` is an element id) and
`ui/index.html:411` (`[^` is part of a regular expression).

## Items still open from 2026-11-03

The audit confirms these items of `docs/findings/2026-11-03-ui-design-fixes.md`.
Their line numbers have moved:

- **7. Raw colours:** `#fff` at `ui/app.css:841` and `888`; the shadows at
  `ui/index.html:490` and `494`.
- **8. Chart series colours:** `PALETTE_EXTRA` at `ui/lib.js:153`.
- **9. Login page:** `ui/auth.ts:52–56`, with 7 colour literals, a 6px
  radius and a 16px font.
- **10. Breakpoints:** `(max-width: 720px)` 11, `(min-width: 721px)` 1,
  `(max-width: 1020px)` 2, `(max-width: 1100px)` 1 at `ui/app.css:899`.
  Only the 1100px query is off the rule.
- **11. Weights:** `font-weight` 600 27, 500 5, 400 4.
- **12. Spacing:** 337 rows.
- **13. z-index:** `ui/app.css:592`, `693`, `775` and `ui/index.html:488`.

Item 14 (inline `style="`) is almost done: each inline style sets a computed
value, which the item allows. The one rest is in item A12 below. Item 15 is
replaced by items A2 to A5.

## New items

Each item is one factory goal. The title is the issue title.

### A1. Move font shorthand pixel sizes onto the --fs scale

The inventory reads `font-size` but not the size inside a `font:` shorthand,
so item 5 missed these:

- `ui/app.css:164`: `.mark`, `700 20px/1 var(--brand)`
- `ui/app.css:819`: `.dp-v`, `400 22px/1.15 var(--metric)`
- `ui/app.css:949`: `.gtile b`, `500 18px/1.2 var(--mono)`

The scale has no step between `--fs-lg` (15px) and `--fs-xl` (26px). Map each
size to a step, or add one step for 18–22px if 3 uses share it.

### A2. Write hour-and-minute durations through dur()

`dur()` writes `1h 05m`. Two local copies write `1h05m`, with no space:

- `ui/views/now.js:175`
- `ui/views/speed.js:111`

Use `dur()` in both.

### A3. Write a unit after a number the same way everywhere

The space between a number and its unit differs:

- `dur()`: `43s`, `4m 05s` (no space)
- `durMs()` at `ui/lib.js:52`: `850 ms` (space) and `1.5s` (no space)
- `hours()` at `ui/views/speed.js:7`: `3.2 h` (space)
- `cardHours()` at `ui/views/speed.js:114`: `3.2h` (no space)
- `ui/views/session.js:127` and `137–138`: `0 s` and `0 ms` (space)

`dur()` has the most uses, so the rule is no space. Then record the rule in
the Formats table of `docs/design.md`.

### A4. Show the Runs today cost through money()

`ui/views/factory-agents.js:17` writes `$${(f.costToday ?? 0).toFixed(2)}`
by hand. Use `money()`.

### A5. Remove the unused label from the speed buckets

`ui/api/speed.ts:491` builds a `label` (`MM-DD` or `hh:mm`, with its own `pad`
at `ui/api/speed.ts:136`) for each bucket. No view reads it: `xLabel()` at
`ui/views/speed.js:23` reads `at`. If no test reads it either, remove the
field and the `pad`.

### A6. Build every badge through one shared helper

`badge()` (`ui/lib.js:341`) takes a state and maps it with `tone()`. Eight
places write `<span class="badge …">` by hand:

- `ui/views/gates.js:160`
- `ui/views/memory.js:267`
- `ui/views/now.js:167`, `228`, `287`, `323`
- `ui/views/session.js:246`
- `ui/timeline.js:135` (`tag()`, a local helper with a tone argument)

Three views keep their own tone maps in place of `tone()`:
`BY` at `ui/views/gates.js:44`, `TONE` at `ui/views/memory.js:266` and
`STATUS_TONE` at `ui/views/now.js:166`. Some badges show text that is not a
state (`Recommended`, a kind), so the shared helper needs a text and a tone.
Move `tag()` to `ui/lib.js` or give `badge()` a tone option, and use it in
all eight places.

### A7. Build every chip with the shared chip helper

`chips()` (`ui/lib.js:351`) builds a list of label chips. Six places write
`class="chip"` by hand:

- `ui/views/gates.js:131` (a local `chips()` that hides the shared one)
- `ui/views/memory.js:95`
- `ui/views/jobs.js:235`
- `ui/views/session.js:38`
- `ui/views/issues.js:230` (the kind chip)
- `ui/views/issues.js:598`

Add a one-chip helper next to `chips()` and use it in each place.

### A8. Build each card with card()

Five sections write `class="card"` by hand in place of `card()`:

- `ui/views/gates.js:136`
- `ui/views/memory.js:306`
- `ui/views/now.js:56`
- `ui/views/sessions.js:144`
- `ui/views/issues.js:450`

Use `card()`, or record in `docs/design.md` why a card needs its own markup
(for example an `id` that `card()` cannot set).

### A9. Use the shared tile, pager and empty helpers

- **Tile:** `ui/views/speed.js:139–140` builds `.tile sc` by hand; use `tile()`.
- **Pager:** `ui/views/session.js:95` builds `.pager chat-pager` by hand; use
  `pager()`.
- **Empty state:** `ui/views/now.js:76` defines its own `empty()` with the
  line as a hint; use `empty()` from `ui/lib.js`.

### A10. Show one loading line in every view

`loading()` (`ui/lib.js:77`) writes `<p class="quiet loading" role="status">`.
Five other loading lines differ in class, role and words:

- `ui/views/now.js:38`: `<p role="status">Loading…</p>`, no class
- `ui/views/jobs.js:253`: `Loading the diff…` inside a `<pre>`
- `ui/views/jobs.js:284`: `textContent = "Loading…"`, no role
- `ui/views/memory.js:324`: `<p class="quiet" role="status">Loading the note…</p>`
- `ui/views/factory-agents.js:54`: `<p role="status">Loading…</p>`, no class

Add an inline loading helper (class `quiet`, `role="status"`, `Loading <what>…`)
and use it in each place.

### A11. Build the six hand-written tables with dataTable()

From `docs/design.md`: `ui/views/issues.js:241`, `ui/views/issues.js:617`,
`ui/views/jobs.js:240`, `ui/views/memory.js:46`, `ui/views/session.js:23`
and `ui/views/session.js:259` write `<table class="tbl">` by hand. Use
`dataTable()`. Where a table needs something `dataTable()` cannot do (a row
class, a selected row), give `dataTable()` that option once.

### A12. Use one indent step in the session view

`ui/views/session.js:147` indents a waterfall row by `depth * 14` px, and
`ui/views/session.js:247` indents an observation by `depth * 16` px. Use one
step for both.

### A13. Make the inventory read font shorthands and skip selectors

Two faults of `skills/design-language/scripts/inventory.ts`:

- It does not read the size or weight in a `font:` shorthand (item A1).
- It reads `#eff` in `querySelector("#eff")` as a colour and `[^` in a
  regular expression as a media query.

Fix both, and add a test with these cases; the script has no test now.

## Proposals to amend the doc

New patterns with 3 or more uses. Each one is a rule to add to
`docs/design.md`, or a token, if Chris agrees.

| Pattern | Uses | Where | Proposal |
|---|---|---|---|
| Spacing 2/4/6/8/10/12/16px | 337 rows | all of `ui/app.css` | spacing tokens (item 12) |
| `opacity: .6` for a dimmed control | 3 | `ui/app.css:321`, `343`, `963` | a `--dim` token, or a rule |
| `letter-spacing: -0.01em` on display text | 4 | `ui/app.css:164`, `190`, `191`, `479` | a rule for display type |
| Uppercase key tracking `.06em` and `.08em` | 2 | `ui/app.css:563`, `721` | one value for small-caps keys |
| Control height 28px | 9 (`min-height` 6, `height` 3) | `ui/app.css` | a control-height token |
| Bar height 10px | 8 | `ui/app.css` | a rule for bar and meter height |
| Byte size `KiB`/`MiB` | 1 | `ui/views/jobs.js:127` | a `bytes()` helper if a second use comes |
| Mean with one decimal | 2 | `ui/views/factory-agents.js:19`, `36` | a rule for decimals in a mean |
| Countdown `m:ss` | 1 | `ui/index.html:221` | none; record it |

## Questions for Chris

1. **Date with no time.** `when()` now writes `10/28 14:05`, but `day()` and
   `dateText()` write `Oct 28`. These appear in table date columns (Issues
   `Updated` through `dateText()` at `ui/views/issues.js:232`, Memory `Read` and
   `Written` through `shortDay()` at `ui/views/memory.js:188`) and on chart axes. Should a date with no time
   read `10/28`, to match? The decision of 2026-11-04 lets a chart axis keep
   a short form, but does not say what a table date is.
2. **Time column first in the Gates log.** The column-order rule puts time
   last. The Gates log (`ui/views/gates.js:163`) puts `When` first, and Memory
   notes (`ui/views/memory.js:274`) put `Read` and `Written` before `Status`.
   Does a log keep time first, as an exception to the rule?
3. **Detail page heads.** `ui/views/jobs.js:244` and `ui/views/issues.js:470`
   build their own `<header class="ph"><h1>`, because `pageHead()` has no
   form for a detail page with edit controls. Give `pageHead()` a detail
   form, or record the exception?
