# Pager

A pager splits a long table or list into pages of 50 rows. Next replaces the rows with the next 50, so the page stays one screen of rows and does not grow. A list that the server pages by cursor (`/api/log`) gives each button its cursor in place of a page number.

- Use: under a table of more than 50 rows.
- Not for: a short list; use `moreFold()`.

## Helper

| Helper | Reference |
|---|---|
| `pager(page, total)`; `pageOf()`; `pageRows()`; `pagedTable()` | `ui/views/issues.js` |
| `pager(1, total, step, { at, back, fwd })` for a cursor | `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Previous button | a `chevron-left` glyph; `Previous 50` in `aria-label` and `title` | yes, not on the first page | `.act.glyph`: a square of `--ctl-h` |
| Range | `51–100 of 345` |  | `--num` `--fs-xs` `--fw-mid` tabular, `--muted` |
| Next button | a `chevron-right` glyph; `Next 50` in `aria-label` and `title` | yes, not on the last page | `.act.glyph`: a square of `--ctl-h` |

## Rules

- For a table that the address sorts, filters or searches, use `pager()` with `pageOf()` and `pageRows()`. The page number stays in the address as `page`. A change to the sort, a filter or the search goes back to page 1.
- For a table that does not change, use `pagedTable()`. It turns the page in place.
- Do not use both under one root.
- Next names the rows on the next page, up to 50, in its label: `Next 12` on the last page.
- A list paged by cursor keeps the cursor in the address as `before`. A change to the search drops it.
- After a turn, the top of the table is in view.
- A page number past the end shows the last page.

## Do and don't

| Do | Don't |
|---|---|
| A left chevron, `51–100 of 345`, a right chevron | `Show 50 more`, which grows the page; page numbers |
