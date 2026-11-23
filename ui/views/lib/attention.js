// The attention rows of every page, from one source: GET /api/attention answers `{ [route]: [{ tone, text, act? }] }`.
// The router reads it into this store; the sidebar's dots and a page's own rows (`attention()` in page.js) draw from it.
let held = {};

/** The rows of the page at `path` (its view's route, as `/hooks`); none for a page with no problem. */
export const rowsOf = (path) => held[path] ?? [];

/** The tone of a page's dot: "error" over "need", "" for no row. */
export const worst = (rows) => (rows.some((r) => r.tone === "error") ? "error" : rows.length ? "need" : "");

/** Hold `rows` (the answer of /api/attention); true when they differ from the rows held. */
export function setRows(rows) {
  const same = JSON.stringify(rows) === JSON.stringify(held);
  held = rows;
  return !same;
}
