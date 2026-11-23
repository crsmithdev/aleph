# Pager

A pager splits a long table or list into pages of 50 rows. Next replaces the rows with the next 50, so the page stays one screen of rows and does not grow.

- Use: under a table of more than 50 rows.
- Not for: a short list; use `moreFold()`.

## Helper

| Helper | Reference |
|---|---|
| `pager(page, total)`; `pageOf()`; `pageRows()`; `pagedTable()` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Previous button | `Previous 50` | yes, not on page 1 | the button |
| Next button | `Next 50` | yes, not on the last page | the button |
| Range | `51–100 of 345` |  | `--num` `--fs-xs` `--fw-mid` tabular, `--muted` |

## Rules

- For a table that the address sorts, filters or searches, use `pager()` with `pageOf()` and `pageRows()`. The page number stays in the address as `page`. A change to the sort, a filter or the search goes back to page 1.
- For a table that does not change, use `pagedTable()`. It turns the page in place.
- Do not use both under one root.
- Next names the rows on the next page, up to 50: `Next 12` on the last page.
- After a turn, the top of the table is in view.
- A page number past the end shows the last page.

## Do and don't

| Do | Don't |
|---|---|
| `Previous 50`, `Next 50` with `51–100 of 345` | `Show 50 more`, which grows the page; page numbers |
