# UI design fixes

Source: `bun skills/design-language/scripts/inventory.ts ui --summary` on main at
665677f02c. Line numbers are for that commit.

Summary of the inventory:

| group  | kind          | count |
|--------|---------------|-------|
| colour | literal       | 19    |
| colour | token-def     | 85    |
| size   | literal       | 508   |
| size   | token-use     | 152   |
| type   | literal       | 60    |
| effect | literal       | 48    |
| format | helper-bypass | 92    |

Each item below is one factory goal. Item 1 adds the reference doc that the
other items cite, so add it first. Items 5, 6, 11 and 12 add tokens; each
item adds its tokens and uses them in the same change.

## 1. Write the UI design reference with design-language

Run `/aleph:design-language` in Extract mode to write `docs/design.md`, with
a pointer from `docs/ui.md`. Change no UI code.

## 2. Use one absolute time format in every view

Four formats exist:

- `when()` in `ui/lib.js:291`: `Oct 28 14:05`
- `ui/views/now.js:174`: `10/28 14:05`
- `ui/views/factory-agents.js:38`: `Tue 2:05 PM`
- `ui/views/speed.js:27`: `2p` / `2:30p`

The aleph-199 decision says `mm/dd hh:mm`, but `when()` does a different
format. Chris chooses the format before the factory builds this item. After
that, every view uses the shared helper. A chart axis can keep a short form,
through `day()` or one new helper.

## 3. Add a shared count format to lib.js

`ui/views/sessions.js:40` and `ui/views/memory.js:146` each define
`fmt = (n) => Number(n).toLocaleString("en-US")`. Move it to one `count()` in
`ui/lib.js` and use it in both views.

## 4. Add a shared percent format to lib.js

Code builds percents by hand in `ui/views/factory-agents.js:13`
(`shareText`), `ui/views/speed.js:7,10,99,101,115`, and `wkText` in
`ui/lib.js:21`. Make one `pct()` helper that sets the decimals, the rule for
values below 1%, and the mark for a missing value (`–`). Use it everywhere.

## 5. Move font-size literals onto the --fs type scale

Raw sizes:

- `ui/app.css:621` (`0.86em`)
- `ui/app.css:732` (18px)
- `ui/app.css:733` (12px, which is already `--fs-xs`)
- `ui/app.css:929–931` (10px, 10px, 11px)
- `ui/app.css:840` (11px in the `font:` shorthand of `.dp-bar`)
- `ui/app.css:993` (17px)
- `ui/auth.ts:56` (14px)

The 10px and 11px sizes occur 4 times. Add one `--fs-2xs` step for them, and
map each other size to an existing step.

## 6. Move border-radius literals onto the --r tokens

The tokens are `--r-card: 10px`, `--r-ctl: 6px` and `--r-tag: 4px`. The
literals:

- 1px, 2px or 3px: 13 uses, at `ui/app.css:216, 364, 401, 408, 673, 766, 769, 783, 822, 839, 841, 849`
- 999px (pill): 3 uses, at `ui/app.css:474, 974, 999`
- 8px or 12px: `ui/app.css:624, 1005` and `ui/index.html:494`
- 4px: `ui/index.html:499–501`

Add `--r-hair` and `--r-pill`, and map the other literals to the existing
tokens. Fix the mixed shorthands at `ui/app.css:756, 882, 888, 889` (for
example `var(--r-ctl) 0 0 6px`).

## 7. Replace raw colours in app.css and index.html with tokens

- `#fff` text on coloured bars, at `ui/app.css:840` (`.dp-bar`) and `887`
  (`.obar`). Add an `--on-fill` token and check it in dark mode.
- The shadows at `ui/index.html:490, 494`. Use `--lift`, or add a second
  shadow token.
- The `#000` in the mask gradients at `ui/app.css:628, 685` is correct. Do
  not change it.

## 8. Take chart series colours from the CSS tokens

`PALETTE_EXTRA = ["#C792EA", "#89DDFF"]` at `ui/lib.js:150` sets two series
colours in code. The rest of the chart theme comes from `readTokens`. Add the
two colours as tokens with light and dark values, and read them through
`readTokens`.

## 9. Give the login page the app's colour tokens

`ui/auth.ts:52–56` sets its own dark palette (`#0f1115`, `#e6e8ec`,
`#2a2f3a`, `#171a21`, `#3b6ef5`, `#ff6b6b`), a 6px radius and a 14px font.
It does not use `app.css` and has no light mode. Make it use the app tokens
and the same light and dark switch as the app.

## 10. Cut the UI breakpoints to two named widths

`ui/app.css` uses `max-width: 720px` 13 times, `min-width: 721px` at 572,
`1020px` at 521 and 525, and `1100px` at 898. Keep 720px and one wide
breakpoint (1020px or 1100px). CSS custom properties do not work inside
`@media`, so name the two widths in a comment at the top of `app.css`, and
in `docs/design.md` after item 1.

## 11. Add font-weight tokens and use them

`font-weight` 600 occurs 27 times, 500 occurs 9 times and 400 occurs 4 times,
and no weight token exists. The `font:` shorthand at `ui/app.css:840` also
sets 500. Add one token for each weight and use the tokens.

## 12. Add spacing tokens for gap, padding and margin

Gap, padding and margin use a 2/4/6/8/10/12/16px scale with no tokens. The
most common values are `gap: 8px` (22), `gap: 6px` (16), `gap: 4px` (10),
`gap: 10px` (10), `margin-top: 4px` (9), `margin: 0 0 8px` (8),
`gap: 12px` (7), `gap: 2px` (7) and `padding: 10px 12px` (6). Add a spacing
scale and move gap, padding and margin to it. Leave widths and heights as
they are. This item is large, so the factory can split it by file.

## 13. Put z-index values on one named scale

z-index literals: 1 at `ui/app.css:774`, 2 at `ui/app.css:591` and `692`,
and 50 at `ui/index.html:488` (the font picker). Add named layer tokens (for
example row link, sticky, overlay) and use them.

## 14. Move inline style attributes into app.css classes

`style="` occurs in `ui/timeline.js` (4), `ui/views/session.js` (4),
`ui/views/memory.js` (2), `ui/views/speed.js` (2), `ui/lib.js` (1),
`ui/views/sessions.js` (1) and `ui/views/efficiency.js` (1). Move each fixed
style to a class in `app.css`. A style that sets a computed value, such as a
bar width, stays inline.

## 15. Route remaining format helper bypasses through lib.js

The inventory finds 92 format helper bypasses: date, number and duration
formats that do not use `when`, `day`, `clock`, `money`, `dur` or `durMs`.
Items 2, 3 and 4 fix part of them. After those items, run
`bun skills/design-language/scripts/inventory.ts ui | grep helper-bypass`
and move each remaining bypass to a helper, or record why it stays.
